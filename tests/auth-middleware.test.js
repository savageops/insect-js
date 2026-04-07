import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { apiKeyAuth } from "../server/middleware/auth.js";
import { createKey, revokeKey, setDbPath, resetDbPath } from "../server/db/keys.js";

function tempDbPath() {
  return resolve(tmpdir(), `insect-auth-${randomUUID()}.sqlite`);
}

function removeDbFiles(dbPath) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe("apiKeyAuth middleware", () => {
  let dbPath;
  let validKey;
  let revokedKey;

  beforeEach(() => {
    dbPath = tempDbPath();
    setDbPath(dbPath);
    validKey = createKey("auth-valid").apiKey;
    revokedKey = createKey("auth-revoked").apiKey;
    revokeKey(revokedKey);
  });

  afterEach(() => {
    resetDbPath();
    removeDbFiles(dbPath);
  });

  it("returns 401 when no key is provided", () => {
    const req = { headers: {}, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/API key required/i);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when x-api-key header has valid key", () => {
    const req = { headers: { "x-api-key": validKey }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("reads key from Authorization Bearer header", () => {
    const req = { headers: { authorization: `Bearer ${validKey}` }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("reads key from array-form headers", () => {
    const req = {
      headers: {
        "x-api-key": ["", ` ${validKey} `],
      },
      query: {},
    };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("rejects query-param key usage", () => {
    const req = { headers: {}, query: { apikey: validKey } };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for revoked key", () => {
    const req = { headers: { "x-api-key": revokedKey }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/revoked/i);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 for rate-limited keys", () => {
    const rlKey = createKey("rl", 1).apiKey;
    const req = { headers: { "x-api-key": rlKey }, query: {} };

    apiKeyAuth(req, mockRes(), vi.fn());
    const res = mockRes();
    const next = vi.fn();
    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/Rate limit exceeded/i);
    expect(res.body.code).toBe("rate_limited");
    expect(typeof res.body.retryAfter).toBe("number");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 for search cooldown violations", () => {
    const cooldownKey = createKey("cooldown-test", 100, null, 6).apiKey;

    const firstReq = {
      headers: { "x-api-key": cooldownKey },
      query: {},
      body: { query: "insect crawler" },
    };
    const firstRes = mockRes();
    apiKeyAuth(firstReq, firstRes, vi.fn());
    expect(firstRes.statusCode).toBe(200);

    const req = {
      headers: { "x-api-key": cooldownKey },
      query: {},
      body: { query: "insect crawler" },
    };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/cooldown/i);
    expect(res.body.code).toBe("cooldown");
    expect(typeof res.body.retryAfter).toBe("number");
    expect(res.body.cooldownSeconds).toBe(6);
    expect(next).not.toHaveBeenCalled();
  });
});
