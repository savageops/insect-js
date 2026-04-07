import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateKey,
  createKey,
  revokeKey,
  listKeys,
  getKeyInfo,
  setDbPath,
  resetDbPath,
} from "../server/db/keys.js";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

function tempDbPath() {
  return resolve(tmpdir(), `scraper-test-keys-${randomUUID()}.json`);
}

describe("server/db/keys.js", () => {
  let dbPath;

  beforeEach(() => {
    dbPath = tempDbPath();
    setDbPath(dbPath);
  });

  afterEach(() => {
    if (existsSync(dbPath)) rmSync(dbPath);
    resetDbPath();
  });

  describe("createKey()", () => {
    it("creates a key with sk_ prefix and valid UUID", () => {
      const result = createKey("test-key");
      expect(result.apiKey).toMatch(/^sk_[0-9a-f]{32}$/);
      expect(result.label).toBe("test-key");
      expect(result.active).toBe(true);
      expect(result.rateLimit).toBe(100);
      expect(result.searchCooldownSeconds).toBe(6);
      expect(result.useCount).toBe(0);
      expect(result.createdAt).toBeTruthy();
      expect(result.lastUsed).toBeNull();
      expect(result.expiresAt).toBeNull();
    });

    it("creates a key with custom rate limit", () => {
      const result = createKey("limited", 50);
      expect(result.rateLimit).toBe(50);
    });

    it("creates a key with expiry", () => {
      const result = createKey("expiring", 100, 3600);
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(result.expiresAt).toBeLessThan(Date.now() + 3601 * 1000);
    });

    it("persists the key to disk", () => {
      createKey("persist-test");
      expect(existsSync(dbPath)).toBe(true);
    });

    it("creates multiple unique keys", () => {
      const a = createKey("a");
      const b = createKey("b");
      expect(a.apiKey).not.toBe(b.apiKey);
    });

    it("creates key with undefined label when not specified", () => {
      const result = createKey();
      expect(result.apiKey).toMatch(/^sk_/);
      expect(result.active).toBe(true);
    });
  });

  describe("validateKey()", () => {
    it("returns valid: true for a valid active key", () => {
      const { apiKey } = createKey("valid");
      const result = validateKey(apiKey);
      expect(result.valid).toBe(true);
    });

    it("returns valid: false for missing key", () => {
      const result = validateKey(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing");
    });

    it("returns valid: false for empty string key", () => {
      const result = validateKey("");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("missing");
    });

    it("returns valid: false for unknown key", () => {
      const result = validateKey("sk_nonexistent00000000000000000000000");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("not_found");
    });

    it("returns valid: false for revoked key", () => {
      const { apiKey } = createKey("to-revoke");
      revokeKey(apiKey);
      const result = validateKey(apiKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("revoked");
    });

    it("returns valid: false for expired key and deactivates it", async () => {
      const { apiKey } = createKey("expired", 100, 1);
      await new Promise((r) => setTimeout(r, 1100));
      const result = validateKey(apiKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("expired");
    });

    it("increments useCount on valid validation", () => {
      const { apiKey } = createKey("counter");
      validateKey(apiKey);
      validateKey(apiKey);
      validateKey(apiKey);
      const info = getKeyInfo(apiKey);
      expect(info.useCount).toBe(3);
    });

    it("sets lastUsed on valid validation", () => {
      const { apiKey } = createKey("lastused");
      validateKey(apiKey);
      const info = getKeyInfo(apiKey);
      expect(info.lastUsed).not.toBeNull();
    });
  });

  describe("rate limiting", () => {
    it("blocks requests after rate limit is exceeded", () => {
      const { apiKey } = createKey("ratelimited", 3);

      expect(validateKey(apiKey).valid).toBe(true);
      expect(validateKey(apiKey).valid).toBe(true);
      expect(validateKey(apiKey).valid).toBe(true);

      const result = validateKey(apiKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("rate_limited");
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it("resets window after 60 seconds", () => {
      const { apiKey } = createKey("windowreset", 2);

      validateKey(apiKey);
      validateKey(apiKey);
      expect(validateKey(apiKey).valid).toBe(false);

      const keys = JSON.parse(readFileSync(dbPath, "utf-8"));
      keys[apiKey].windowStart = Date.now() - 61_000;
      writeFileSync(dbPath, JSON.stringify(keys, null, 2), "utf-8");

      expect(validateKey(apiKey).valid).toBe(true);
    });

    it("enforces search cooldown when enabled", () => {
      const { apiKey } = createKey("cooldown", 100, null, 6);

      expect(validateKey(apiKey, { enforceSearchCooldown: true }).valid).toBe(true);

      const result = validateKey(apiKey, { enforceSearchCooldown: true });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("cooldown");
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe("revokeKey()", () => {
    it("revokes an existing key", () => {
      const { apiKey } = createKey("revoke-me");
      expect(revokeKey(apiKey)).toBe(true);
      const result = validateKey(apiKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("revoked");
    });

    it("returns false for non-existent key", () => {
      expect(revokeKey("sk_nothing0000000000000000000000000")).toBe(false);
    });

    it("sets revokedAt timestamp", () => {
      const { apiKey } = createKey("check-revoke");
      revokeKey(apiKey);
      const info = getKeyInfo(apiKey);
      expect(info.revokedAt).toBeTruthy();
    });
  });

  describe("listKeys()", () => {
    it("returns array of keys with masked API keys", () => {
      createKey("list-a");
      createKey("list-b");
      const keys = listKeys();
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const k of keys) {
        expect(k.apiKey).toMatch(/^sk_[0-9a-f]{9}\.\.\.$/);
      }
    });
  });

  describe("getKeyInfo()", () => {
    it("returns key info with masked key", () => {
      const { apiKey } = createKey("info-test");
      const info = getKeyInfo(apiKey);
      expect(info).toBeTruthy();
      expect(info.label).toBe("info-test");
      expect(info.apiKey).toMatch(/^sk_[0-9a-f]{9}\.\.\.$/);
    });

    it("returns null for non-existent key", () => {
      expect(getKeyInfo("sk_nothing0000000000000000000000000")).toBeNull();
    });
  });
});
