import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_SEARCH_COOLDOWN_SECONDS } from "../core/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(__dirname, "..", "..", "data", "keys.sqlite");
const LEGACY_JSON_PATH = resolve(__dirname, "..", "..", "data", "keys.json");
const DEFAULT_RATE_LIMIT = 100;
const MAX_RATE_LIMIT = 10_000;
const MAX_SEARCH_COOLDOWN_SECONDS = 3600;
const RATE_LIMIT_WINDOW_MS = 60_000;

let _dbPath = DEFAULT_DB_PATH;
let _db = null;

function closeDbIfOpen() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function dbPathToLegacyJsonPath(dbPath) {
  const baseDir = dirname(dbPath);
  return resolve(baseDir, "keys.json");
}

function parseLegacyKeys() {
  const candidates = [dbPathToLegacyJsonPath(_dbPath), LEGACY_JSON_PATH];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function ensureSchema(db) {
  db.exec(`
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
  `);
}

function normalizeRateLimit(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > MAX_RATE_LIMIT) {
    return DEFAULT_RATE_LIMIT;
  }
  return numeric;
}

function normalizeExpiresInSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizeSearchCooldownSeconds(value) {
  const numeric = Number(value);
  if (
    !Number.isInteger(numeric)
    || numeric < MIN_SEARCH_COOLDOWN_SECONDS
    || numeric > MAX_SEARCH_COOLDOWN_SECONDS
  ) {
    return MIN_SEARCH_COOLDOWN_SECONDS;
  }
  return numeric;
}

function toBooleanFlag(value) {
  return value ? 1 : 0;
}

function getDb() {
  if (_db) return _db;

  const dbDir = dirname(_dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(_dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  ensureSchema(db);

  const keyCount = db.prepare("SELECT COUNT(*) AS count FROM api_keys").get().count;
  if (keyCount === 0) {
    const legacyKeys = parseLegacyKeys();
    if (legacyKeys) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO api_keys (
          api_key, label, active, rate_limit, search_cooldown_seconds,
          use_count, created_at, last_used, expires_at, expired_at, revoked_at,
          window_start, window_count, last_search_at, last_search_at_iso
        ) VALUES (
          @api_key, @label, @active, @rate_limit, @search_cooldown_seconds,
          @use_count, @created_at, @last_used, @expires_at, @expired_at, @revoked_at,
          @window_start, @window_count, @last_search_at, @last_search_at_iso
        )
      `);
      const migrate = db.transaction((entries) => {
        for (const [apiKey, value] of entries) {
          insert.run({
            api_key: apiKey,
            label: String(value?.label ?? "unnamed"),
            active: toBooleanFlag(value?.active !== false),
            rate_limit: normalizeRateLimit(value?.rateLimit),
            search_cooldown_seconds: normalizeSearchCooldownSeconds(value?.searchCooldownSeconds),
            use_count: Number.isInteger(value?.useCount) ? value.useCount : 0,
            created_at: value?.createdAt || new Date().toISOString(),
            last_used: value?.lastUsed || null,
            expires_at: Number.isInteger(value?.expiresAt) ? value.expiresAt : null,
            expired_at: value?.expiredAt || null,
            revoked_at: value?.revokedAt || null,
            window_start: Number.isInteger(value?.windowStart) ? value.windowStart : null,
            window_count: Number.isInteger(value?.windowCount) ? value.windowCount : 0,
            last_search_at: Number.isInteger(value?.lastSearchAt) ? value.lastSearchAt : null,
            last_search_at_iso: value?.lastSearchAtIso || null,
          });
        }
      });
      migrate(Object.entries(legacyKeys));
    }
  }

  _db = db;
  return _db;
}

function withImmediateTransaction(fn) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors.
    }
    throw err;
  }
}

function maskKey(apiKey) {
  return `${apiKey.substring(0, 12)}...`;
}

function mapRowToPublic(row, { mask = true } = {}) {
  if (!row) return null;
  return {
    apiKey: mask ? maskKey(row.api_key) : row.api_key,
    label: row.label,
    active: row.active === 1,
    rateLimit: row.rate_limit,
    searchCooldownSeconds: row.search_cooldown_seconds,
    useCount: row.use_count,
    createdAt: row.created_at,
    lastUsed: row.last_used,
    expiresAt: row.expires_at,
    expiredAt: row.expired_at,
    revokedAt: row.revoked_at,
    windowStart: row.window_start,
    windowCount: row.window_count,
    lastSearchAt: row.last_search_at,
    lastSearchAtIso: row.last_search_at_iso,
  };
}

export function setDbPath(path) {
  closeDbIfOpen();
  _dbPath = path;
}

export function resetDbPath() {
  closeDbIfOpen();
  _dbPath = DEFAULT_DB_PATH;
}

export function validateKey(apiKey, { enforceSearchCooldown = false } = {}) {
  if (!apiKey) return { valid: false, reason: "missing" };

  return withImmediateTransaction((db) => {
    const selectStmt = db.prepare("SELECT * FROM api_keys WHERE api_key = ?");
    const updateStmt = db.prepare(`
      UPDATE api_keys
      SET
        active = @active,
        rate_limit = @rate_limit,
        search_cooldown_seconds = @search_cooldown_seconds,
        use_count = @use_count,
        last_used = @last_used,
        expires_at = @expires_at,
        expired_at = @expired_at,
        window_start = @window_start,
        window_count = @window_count,
        last_search_at = @last_search_at,
        last_search_at_iso = @last_search_at_iso
      WHERE api_key = @api_key
    `);

    const row = selectStmt.get(apiKey);
    if (!row) return { valid: false, reason: "not_found" };
    if (row.active !== 1) return { valid: false, reason: "revoked" };

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const normalizedRateLimit = normalizeRateLimit(row.rate_limit);
    const normalizedCooldown = normalizeSearchCooldownSeconds(row.search_cooldown_seconds);

    let active = row.active;
    let useCount = row.use_count || 0;
    let lastUsed = row.last_used || null;
    let expiresAt = row.expires_at || null;
    let expiredAt = row.expired_at || null;
    let windowStart = row.window_start || null;
    let windowCount = row.window_count || 0;
    let lastSearchAt = row.last_search_at || null;
    let lastSearchAtIso = row.last_search_at_iso || null;

    if (expiresAt && now > expiresAt) {
      active = 0;
      expiredAt = nowIso;
      updateStmt.run({
        api_key: apiKey,
        active,
        rate_limit: normalizedRateLimit,
        search_cooldown_seconds: normalizedCooldown,
        use_count: useCount,
        last_used: lastUsed,
        expires_at: expiresAt,
        expired_at: expiredAt,
        window_start: windowStart,
        window_count: windowCount,
        last_search_at: lastSearchAt,
        last_search_at_iso: lastSearchAtIso,
      });
      return { valid: false, reason: "expired" };
    }

    if (enforceSearchCooldown && lastSearchAt) {
      const cooldownMs = normalizedCooldown * 1000;
      const elapsedSinceLastSearch = now - lastSearchAt;
      if (elapsedSinceLastSearch < cooldownMs) {
        updateStmt.run({
          api_key: apiKey,
          active,
          rate_limit: normalizedRateLimit,
          search_cooldown_seconds: normalizedCooldown,
          use_count: useCount,
          last_used: lastUsed,
          expires_at: expiresAt,
          expired_at: expiredAt,
          window_start: windowStart,
          window_count: windowCount,
          last_search_at: lastSearchAt,
          last_search_at_iso: lastSearchAtIso,
        });
        return {
          valid: false,
          reason: "cooldown",
          retryAfter: Math.ceil((cooldownMs - elapsedSinceLastSearch) / 1000),
          cooldownSeconds: normalizedCooldown,
        };
      }
    }

    if (!windowStart || now - windowStart > RATE_LIMIT_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }

    windowCount += 1;
    if (windowCount > normalizedRateLimit) {
      updateStmt.run({
        api_key: apiKey,
        active,
        rate_limit: normalizedRateLimit,
        search_cooldown_seconds: normalizedCooldown,
        use_count: useCount,
        last_used: lastUsed,
        expires_at: expiresAt,
        expired_at: expiredAt,
        window_start: windowStart,
        window_count: windowCount,
        last_search_at: lastSearchAt,
        last_search_at_iso: lastSearchAtIso,
      });
      return {
        valid: false,
        reason: "rate_limited",
        retryAfter: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - windowStart)) / 1000),
      };
    }

    useCount += 1;
    lastUsed = nowIso;
    if (enforceSearchCooldown) {
      lastSearchAt = now;
      lastSearchAtIso = nowIso;
    }

    updateStmt.run({
      api_key: apiKey,
      active,
      rate_limit: normalizedRateLimit,
      search_cooldown_seconds: normalizedCooldown,
      use_count: useCount,
      last_used: lastUsed,
      expires_at: expiresAt,
      expired_at: expiredAt,
      window_start: windowStart,
      window_count: windowCount,
      last_search_at: lastSearchAt,
      last_search_at_iso: lastSearchAtIso,
    });

    return { valid: true };
  });
}

export function createKey(
  label = "unnamed",
  rateLimit = DEFAULT_RATE_LIMIT,
  expiresInSeconds = null,
  searchCooldownSeconds = MIN_SEARCH_COOLDOWN_SECONDS,
) {
  const apiKey = `sk_${randomUUID().replace(/-/g, "")}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const normalizedRateLimit = normalizeRateLimit(rateLimit);
  const normalizedExpiresIn = normalizeExpiresInSeconds(expiresInSeconds);
  const normalizedCooldown = normalizeSearchCooldownSeconds(searchCooldownSeconds);

  withImmediateTransaction((db) => {
    const insert = db.prepare(`
      INSERT INTO api_keys (
        api_key, label, active, rate_limit, search_cooldown_seconds,
        use_count, created_at, last_used, expires_at, expired_at, revoked_at,
        window_start, window_count, last_search_at, last_search_at_iso
      ) VALUES (
        @api_key, @label, 1, @rate_limit, @search_cooldown_seconds,
        0, @created_at, NULL, @expires_at, NULL, NULL,
        NULL, 0, NULL, NULL
      )
    `);

    insert.run({
      api_key: apiKey,
      label: String(label),
      rate_limit: normalizedRateLimit,
      search_cooldown_seconds: normalizedCooldown,
      created_at: nowIso,
      expires_at: normalizedExpiresIn ? now + normalizedExpiresIn * 1000 : null,
    });
  });

  return {
    apiKey,
    label: String(label),
    active: true,
    rateLimit: normalizedRateLimit,
    searchCooldownSeconds: normalizedCooldown,
    useCount: 0,
    createdAt: nowIso,
    lastUsed: null,
    expiresAt: normalizedExpiresIn ? now + normalizedExpiresIn * 1000 : null,
    expiredAt: null,
    revokedAt: null,
    windowStart: null,
    windowCount: 0,
    lastSearchAt: null,
    lastSearchAtIso: null,
  };
}

export function revokeKey(apiKey) {
  if (!apiKey) return false;
  return withImmediateTransaction((db) => {
    const row = db.prepare("SELECT api_key FROM api_keys WHERE api_key = ?").get(apiKey);
    if (!row) return false;
    db.prepare("UPDATE api_keys SET active = 0, revoked_at = ? WHERE api_key = ?")
      .run(new Date().toISOString(), apiKey);
    return true;
  });
}

export function listKeys() {
  const rows = getDb()
    .prepare("SELECT * FROM api_keys ORDER BY created_at DESC")
    .all();
  return rows.map((row) => mapRowToPublic(row, { mask: true }));
}

export function getKeyInfo(apiKey) {
  if (!apiKey) return null;
  const row = getDb().prepare("SELECT * FROM api_keys WHERE api_key = ?").get(apiKey);
  return mapRowToPublic(row, { mask: true });
}
