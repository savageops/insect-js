use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use rand::distr::{Alphanumeric, SampleString};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::contracts::MIN_SEARCH_COOLDOWN_SECONDS;

const DEFAULT_RATE_LIMIT: i64 = 100;
const MAX_RATE_LIMIT: i64 = 10_000;
const MAX_SEARCH_COOLDOWN_SECONDS: i64 = 3600;
const RATE_LIMIT_WINDOW_MS: i64 = 60_000;

#[derive(Clone)]
pub struct KeyStore {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyRecord {
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub label: String,
    pub active: bool,
    #[serde(rename = "rateLimit")]
    pub rate_limit: i64,
    #[serde(rename = "searchCooldownSeconds")]
    pub search_cooldown_seconds: i64,
    #[serde(rename = "useCount")]
    pub use_count: i64,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<i64>,
    #[serde(rename = "expiredAt")]
    pub expired_at: Option<String>,
    #[serde(rename = "revokedAt")]
    pub revoked_at: Option<String>,
    #[serde(rename = "windowStart")]
    pub window_start: Option<i64>,
    #[serde(rename = "windowCount")]
    pub window_count: i64,
    #[serde(rename = "lastSearchAt")]
    pub last_search_at: Option<i64>,
    #[serde(rename = "lastSearchAtIso")]
    pub last_search_at_iso: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateKeyInput {
    pub label: Option<String>,
    pub rate_limit: Option<i64>,
    pub search_cooldown_seconds: Option<i64>,
    pub expires_in_seconds: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ValidationContext {
    pub enforce_search_cooldown: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationFailure {
    pub status: u16,
    pub error: String,
    pub code: String,
    #[serde(rename = "retryAfter", skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<i64>,
    #[serde(rename = "cooldownSeconds", skip_serializing_if = "Option::is_none")]
    pub cooldown_seconds: Option<i64>,
}

impl KeyStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).with_context(|| {
                format!("failed to create key database dir {}", parent.display())
            })?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("failed to open SQLite database {}", path.display()))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS api_keys (
              api_key TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              rate_limit INTEGER NOT NULL,
              search_cooldown_seconds INTEGER NOT NULL,
              use_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              last_used TEXT,
              expires_at INTEGER,
              expired_at TEXT,
              revoked_at TEXT,
              window_start INTEGER,
              window_count INTEGER NOT NULL DEFAULT 0,
              last_search_at INTEGER,
              last_search_at_iso TEXT
            );
            "#,
        )?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn create_key(&self, input: CreateKeyInput) -> Result<KeyRecord> {
        let api_key = generate_api_key();
        let label = input.label.unwrap_or_else(|| "unnamed".to_string());
        let rate_limit = normalize_rate_limit(input.rate_limit.unwrap_or(DEFAULT_RATE_LIMIT));
        let search_cooldown_seconds = normalize_search_cooldown(
            input
                .search_cooldown_seconds
                .unwrap_or(MIN_SEARCH_COOLDOWN_SECONDS),
        );
        let now = Utc::now();
        let expires_at = input
            .expires_in_seconds
            .map(|seconds| now.timestamp_millis() + (seconds * 1000));

        {
            let conn = self
                .conn
                .lock()
                .map_err(|_| anyhow!("key database mutex poisoned"))?;
            conn.execute(
                r#"
                INSERT INTO api_keys (
                  api_key, label, active, rate_limit, search_cooldown_seconds,
                  use_count, created_at, last_used, expires_at, expired_at, revoked_at,
                  window_start, window_count, last_search_at, last_search_at_iso
                ) VALUES (?1, ?2, 1, ?3, ?4, 0, ?5, NULL, ?6, NULL, NULL, NULL, 0, NULL, NULL)
                "#,
                params![
                    api_key,
                    label,
                    rate_limit,
                    search_cooldown_seconds,
                    now.to_rfc3339(),
                    expires_at
                ],
            )?;
        }

        self.get_key(&api_key, false)?
            .ok_or_else(|| anyhow!("created key could not be re-read"))
    }

    pub fn list_keys(&self) -> Result<Vec<KeyRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("key database mutex poisoned"))?;
        let mut stmt = conn.prepare(
            r#"
            SELECT api_key, label, active, rate_limit, search_cooldown_seconds, use_count,
                   created_at, last_used, expires_at, expired_at, revoked_at,
                   window_start, window_count, last_search_at, last_search_at_iso
            FROM api_keys
            ORDER BY created_at DESC
            "#,
        )?;

        let rows = stmt.query_map([], |row| map_row(row, true))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_key(&self, api_key: &str, masked: bool) -> Result<Option<KeyRecord>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("key database mutex poisoned"))?;
        conn.query_row(
            r#"
            SELECT api_key, label, active, rate_limit, search_cooldown_seconds, use_count,
                   created_at, last_used, expires_at, expired_at, revoked_at,
                   window_start, window_count, last_search_at, last_search_at_iso
            FROM api_keys
            WHERE api_key = ?1
            "#,
            params![api_key],
            |row| map_row(row, masked),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn revoke_key(&self, api_key: &str) -> Result<bool> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("key database mutex poisoned"))?;
        let now = Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE api_keys SET active = 0, revoked_at = ?2 WHERE api_key = ?1",
            params![api_key, now],
        )?;
        Ok(changed > 0)
    }

    pub fn validate_key(
        &self,
        api_key: &str,
        context: ValidationContext,
    ) -> Result<(), ValidationFailure> {
        if api_key.trim().is_empty() {
            return Err(ValidationFailure {
                status: 401,
                error: "API key required via x-api-key or Authorization header.".to_string(),
                code: "auth_required".to_string(),
                retry_after: None,
                cooldown_seconds: None,
            });
        }

        let conn = self.conn.lock().map_err(|_| ValidationFailure {
            status: 500,
            error: "Key database unavailable.".to_string(),
            code: "key_store_error".to_string(),
            retry_after: None,
            cooldown_seconds: None,
        })?;

        let tx = conn
            .unchecked_transaction()
            .map_err(|_| ValidationFailure {
                status: 500,
                error: "Key database unavailable.".to_string(),
                code: "key_store_error".to_string(),
                retry_after: None,
                cooldown_seconds: None,
            })?;

        let mut record = tx
            .query_row(
                r#"
                SELECT api_key, label, active, rate_limit, search_cooldown_seconds, use_count,
                       created_at, last_used, expires_at, expired_at, revoked_at,
                       window_start, window_count, last_search_at, last_search_at_iso
                FROM api_keys
                WHERE api_key = ?1
                "#,
                params![api_key],
                |row| map_row(row, false),
            )
            .optional()
            .map_err(|_| ValidationFailure {
                status: 500,
                error: "Key database unavailable.".to_string(),
                code: "key_store_error".to_string(),
                retry_after: None,
                cooldown_seconds: None,
            })?
            .ok_or_else(|| ValidationFailure {
                status: 403,
                error: "Invalid API key.".to_string(),
                code: "invalid_key".to_string(),
                retry_after: None,
                cooldown_seconds: None,
            })?;

        if !record.active {
            return Err(ValidationFailure {
                status: 403,
                error: "API key has been revoked.".to_string(),
                code: "revoked".to_string(),
                retry_after: None,
                cooldown_seconds: None,
            });
        }

        let now_ms = Utc::now().timestamp_millis();
        let now_iso = Utc::now().to_rfc3339();

        if let Some(expires_at) = record.expires_at {
            if now_ms > expires_at {
                tx.execute(
                    "UPDATE api_keys SET active = 0, expired_at = ?2 WHERE api_key = ?1",
                    params![api_key, now_iso],
                )
                .map_err(|_| ValidationFailure {
                    status: 500,
                    error: "Key database unavailable.".to_string(),
                    code: "key_store_error".to_string(),
                    retry_after: None,
                    cooldown_seconds: None,
                })?;
                tx.commit().map_err(|_| ValidationFailure {
                    status: 500,
                    error: "Key database unavailable.".to_string(),
                    code: "key_store_error".to_string(),
                    retry_after: None,
                    cooldown_seconds: None,
                })?;
                return Err(ValidationFailure {
                    status: 403,
                    error: "API key has expired.".to_string(),
                    code: "expired".to_string(),
                    retry_after: None,
                    cooldown_seconds: None,
                });
            }
        }

        if context.enforce_search_cooldown {
            if let Some(last_search_at) = record.last_search_at {
                let cooldown_ms = record.search_cooldown_seconds * 1000;
                let elapsed = now_ms - last_search_at;
                if elapsed < cooldown_ms {
                    let retry_after = ((cooldown_ms - elapsed) + 999) / 1000;
                    return Err(ValidationFailure {
                        status: 429,
                        error: format!(
                            "Search cooldown active. Retry after {retry_after}s. Minimum {}s between search queries per API key.",
                            record.search_cooldown_seconds
                        ),
                        code: "cooldown".to_string(),
                        retry_after: Some(retry_after),
                        cooldown_seconds: Some(record.search_cooldown_seconds),
                    });
                }
            }
        }

        let mut window_start = record.window_start.unwrap_or(now_ms);
        let mut window_count = record.window_count;
        if now_ms - window_start > RATE_LIMIT_WINDOW_MS {
            window_start = now_ms;
            window_count = 0;
        }
        window_count += 1;

        if window_count > normalize_rate_limit(record.rate_limit) {
            return Err(ValidationFailure {
                status: 429,
                error: "Rate limit exceeded. Retry after 60s.".to_string(),
                code: "rate_limited".to_string(),
                retry_after: Some(60),
                cooldown_seconds: None,
            });
        }

        record.use_count += 1;
        record.last_used = Some(now_iso.clone());
        record.window_start = Some(window_start);
        record.window_count = window_count;
        if context.enforce_search_cooldown {
            record.last_search_at = Some(now_ms);
            record.last_search_at_iso = Some(now_iso.clone());
        }

        tx.execute(
            r#"
            UPDATE api_keys
            SET use_count = ?2,
                last_used = ?3,
                window_start = ?4,
                window_count = ?5,
                last_search_at = ?6,
                last_search_at_iso = ?7
            WHERE api_key = ?1
            "#,
            params![
                api_key,
                record.use_count,
                record.last_used,
                record.window_start,
                record.window_count,
                record.last_search_at,
                record.last_search_at_iso
            ],
        )
        .map_err(|_| ValidationFailure {
            status: 500,
            error: "Key database unavailable.".to_string(),
            code: "key_store_error".to_string(),
            retry_after: None,
            cooldown_seconds: None,
        })?;
        tx.commit().map_err(|_| ValidationFailure {
            status: 500,
            error: "Key database unavailable.".to_string(),
            code: "key_store_error".to_string(),
            retry_after: None,
            cooldown_seconds: None,
        })?;
        Ok(())
    }
}

fn map_row(row: &rusqlite::Row<'_>, masked: bool) -> rusqlite::Result<KeyRecord> {
    let api_key: String = row.get(0)?;
    Ok(KeyRecord {
        api_key: if masked { mask_key(&api_key) } else { api_key },
        label: row.get(1)?,
        active: row.get::<_, i64>(2)? == 1,
        rate_limit: row.get(3)?,
        search_cooldown_seconds: row.get(4)?,
        use_count: row.get(5)?,
        created_at: row.get(6)?,
        last_used: row.get(7)?,
        expires_at: row.get(8)?,
        expired_at: row.get(9)?,
        revoked_at: row.get(10)?,
        window_start: row.get(11)?,
        window_count: row.get(12)?,
        last_search_at: row.get(13)?,
        last_search_at_iso: row.get(14)?,
    })
}

fn normalize_rate_limit(value: i64) -> i64 {
    value.clamp(1, MAX_RATE_LIMIT)
}

fn normalize_search_cooldown(value: i64) -> i64 {
    value.clamp(MIN_SEARCH_COOLDOWN_SECONDS, MAX_SEARCH_COOLDOWN_SECONDS)
}

fn mask_key(value: &str) -> String {
    if value.len() <= 12 {
        format!("{value}...")
    } else {
        format!("{}...", &value[..12])
    }
}

fn generate_api_key() -> String {
    let mut rng = rand::rng();
    format!("sk_{}", Alphanumeric.sample_string(&mut rng, 32))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_and_reads_key() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("keys.sqlite");
        let store = KeyStore::open(&path).unwrap();
        let created = store
            .create_key(CreateKeyInput {
                label: Some("test".to_string()),
                rate_limit: Some(10),
                search_cooldown_seconds: Some(6),
                expires_in_seconds: None,
            })
            .unwrap();

        assert!(created.api_key.starts_with("sk_"));
        let fetched = store.get_key(&created.api_key, false).unwrap().unwrap();
        assert_eq!(fetched.label, "test");
    }
}
