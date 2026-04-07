import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(__dirname, "..", "..", "data", "keys.json");
const DEFAULT_RATE_LIMIT = 100;
const MAX_RATE_LIMIT = 10_000;
const DEFAULT_SEARCH_COOLDOWN_SECONDS = 6;
const MAX_SEARCH_COOLDOWN_SECONDS = 3600;

let _dbPath = DEFAULT_DB_PATH;

export function setDbPath(path) {
  _dbPath = path;
}

export function resetDbPath() {
  _dbPath = DEFAULT_DB_PATH;
}

function loadKeys() {
  if (!existsSync(_dbPath)) return {};
  try {
    return JSON.parse(readFileSync(_dbPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveKeys(keys) {
  const dir = dirname(_dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tempPath = `${_dbPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(keys, null, 2), "utf-8");
  renameSync(tempPath, _dbPath);
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
    || numeric < DEFAULT_SEARCH_COOLDOWN_SECONDS
    || numeric > MAX_SEARCH_COOLDOWN_SECONDS
  ) {
    return DEFAULT_SEARCH_COOLDOWN_SECONDS;
  }
  return numeric;
}

export function validateKey(apiKey, { enforceSearchCooldown = false } = {}) {
  if (!apiKey) return { valid: false, reason: "missing" };
  const keys = loadKeys();
  const entry = keys[apiKey];
  if (!entry) return { valid: false, reason: "not_found" };
  if (!entry.active) return { valid: false, reason: "revoked" };
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    entry.active = false;
    entry.expiredAt = new Date().toISOString();
    saveKeys(keys);
    return { valid: false, reason: "expired" };
  }

  const rateLimit = normalizeRateLimit(entry.rateLimit);
  entry.rateLimit = rateLimit;
  const searchCooldownSeconds = normalizeSearchCooldownSeconds(
    entry.searchCooldownSeconds,
  );
  entry.searchCooldownSeconds = searchCooldownSeconds;

  const windowMs = 60_000;
  const now = Date.now();

  if (enforceSearchCooldown && entry.lastSearchAt) {
    const elapsedSinceLastSearch = now - entry.lastSearchAt;
    const cooldownMs = searchCooldownSeconds * 1000;
    if (elapsedSinceLastSearch < cooldownMs) {
      const retryAfter = Math.ceil((cooldownMs - elapsedSinceLastSearch) / 1000);
      saveKeys(keys);
      return {
        valid: false,
        reason: "cooldown",
        retryAfter,
        cooldownSeconds: searchCooldownSeconds,
      };
    }
  }

  if (!entry.windowStart || now - entry.windowStart > windowMs) {
    entry.windowStart = now;
    entry.windowCount = 0;
  }
  entry.windowCount = (entry.windowCount || 0) + 1;
  if (entry.windowCount > rateLimit) {
    saveKeys(keys);
    return { valid: false, reason: "rate_limited", retryAfter: Math.ceil((windowMs - (now - entry.windowStart)) / 1000) };
  }

  entry.lastUsed = new Date().toISOString();
  entry.useCount = (entry.useCount || 0) + 1;
  if (enforceSearchCooldown) {
    entry.lastSearchAt = now;
    entry.lastSearchAtIso = new Date(now).toISOString();
  }
  saveKeys(keys);
  return { valid: true };
}

export function createKey(
  label = "unnamed",
  rateLimit = DEFAULT_RATE_LIMIT,
  expiresInSeconds = null,
  searchCooldownSeconds = DEFAULT_SEARCH_COOLDOWN_SECONDS,
) {
  const keys = loadKeys();
  const apiKey = `sk_${randomUUID().replace(/-/g, "")}`;
  const normalizedRateLimit = normalizeRateLimit(rateLimit);
  const normalizedExpiresIn = normalizeExpiresInSeconds(expiresInSeconds);
  const normalizedSearchCooldown = normalizeSearchCooldownSeconds(searchCooldownSeconds);
  keys[apiKey] = {
    label: String(label),
    active: true,
    rateLimit: normalizedRateLimit,
    searchCooldownSeconds: normalizedSearchCooldown,
    useCount: 0,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    lastSearchAt: null,
    lastSearchAtIso: null,
    expiresAt: normalizedExpiresIn ? Date.now() + normalizedExpiresIn * 1000 : null,
  };
  saveKeys(keys);
  return { apiKey, ...keys[apiKey] };
}

export function revokeKey(apiKey) {
  const keys = loadKeys();
  if (!keys[apiKey]) return false;
  keys[apiKey].active = false;
  keys[apiKey].revokedAt = new Date().toISOString();
  saveKeys(keys);
  return true;
}

export function listKeys() {
  const keys = loadKeys();
  return Object.entries(keys).map(([apiKey, data]) => ({
    apiKey: apiKey.substring(0, 12) + "...",
    ...data,
  }));
}

export function getKeyInfo(apiKey) {
  const keys = loadKeys();
  if (!keys[apiKey]) return null;
  const data = keys[apiKey];
  return { apiKey: apiKey.substring(0, 12) + "...", ...data };
}
