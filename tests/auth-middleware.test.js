import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiKeyAuth } from "../server/middleware/auth.js";
import { createKey, revokeKey, setDbPath, resetDbPath } from "../server/db/keys.js";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

function tempDbPath() {
  return resolve(tmpdir(), `scraper-auth-test-${randomUUID()}.json`);
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
    if (existsSync(dbPath)) rmSync(dbPath);
    resetDbPath();
  });

  it("returns 401 when no key is provided", () => {
    const req = { headers: {}, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/API key required/);
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

  it("reads key from query param apikey", () => {
    const req = { headers: {}, query: { apikey: validKey } };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("returns 403 for invalid/not-found key", () => {
    const req = { headers: { "x-api-key": "sk_nonexistent00000000000000000000000" }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/Invalid API key/);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for revoked key", () => {
    const req = { headers: { "x-api-key": revokedKey }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/revoked/);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 429 for rate limited key", () => {
    const rlKey = createKey("rl", 1).apiKey;

    const keys = JSON.parse(readFileSync(dbPath, "utf-8"));
    keys[rlKey].windowCount = 2;
    keys[rlKey].windowStart = Date.now();
    writeFileSync(dbPath, JSON.stringify(keys, null, 2), "utf-8");

    const req = { headers: { "x-api-key": rlKey }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/Rate limit exceeded/);
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
    expect(next).not.toHaveBeenCalled();
  });

  it("prioritizes x-api-key over authorization header", () => {
    const req = {
      headers: { "x-api-key": validKey, authorization: "Bearer sk_other" },
      query: {},
    };
    const res = mockRes();
    const next = vi.fn();

    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
