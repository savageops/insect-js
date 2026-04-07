import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { app } from "../server/index.js";
import {
  createKey,
  revokeKey,
  setDbPath,
  resetDbPath,
} from "../server/db/keys.js";

const ADMIN_KEY = "admin_change_me";
const itLive = process.env.LIVE_INTEGRATION === "1" ? it : it.skip;

function tempDbPath() {
  return resolve(tmpdir(), `insect-routes-${randomUUID()}.sqlite`);
}

function removeDbFiles(dbPath) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
}

let dbPath;

beforeEach(() => {
  dbPath = tempDbPath();
  setDbPath(dbPath);
});

afterEach(() => {
  resetDbPath();
  removeDbFiles(dbPath);
});

describe("GET /health", () => {
  it("returns 200 with status and observability metrics", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("insect");
    expect(res.body.version).toBe("1.0.0");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.observability).toBeTruthy();
    expect(typeof res.body.observability.success).toBe("number");
    expect(typeof res.body.observability.blocked).toBe("number");
    expect(typeof res.body.observability.fallback_depth).toBe("number");
    expect(typeof res.body.observability.p95).toBe("number");
    expect(typeof res.body.observability["429s"]).toBe("number");
  });
});

describe("POST /api/keys (admin routes)", () => {
  it("blocks access without admin key", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .send({ label: "blocked" });
    expect(res.status).toBe(403);
  });

  it("creates a key with valid admin key via header", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .set("x-admin-key", ADMIN_KEY)
      .send({ label: "test-create" });
    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^sk_/);
    expect(res.body.label).toBe("test-create");
    expect(res.body.active).toBe(true);
  });

  it("creates a key via Authorization Bearer header", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .set("authorization", `Bearer ${ADMIN_KEY}`)
      .send({ label: "bearer-admin" });
    expect(res.status).toBe(201);
  });

  it("creates a key via lowercase bearer authorization", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .set("authorization", `bearer ${ADMIN_KEY}`)
      .send({ label: "bearer-admin-lowercase" });
    expect(res.status).toBe(201);
  });

  it("rejects admin query-param auth", async () => {
    const res = await request(app)
      .post("/api/keys/create?adminkey=" + ADMIN_KEY)
      .send({ label: "query-admin" });
    expect(res.status).toBe(403);
  });

  it("creates key with custom rate limit and expiry", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .set("x-admin-key", ADMIN_KEY)
      .send({ label: "custom", rateLimit: 50, expiresIn: 3600, searchCooldownSeconds: 6 });
    expect(res.status).toBe(201);
    expect(res.body.rateLimit).toBe(50);
    expect(res.body.searchCooldownSeconds).toBe(6);
    expect(res.body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("lists all keys", async () => {
    createKey("list-test-1");
    createKey("list-test-2");
    const res = await request(app)
      .get("/api/keys")
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(2);
  });
});

describe("POST /api/engine", () => {
  let testKey;

  beforeEach(() => {
    testKey = createKey("engine-test").apiKey;
  });

  it("returns 401 without API key", async () => {
    const res = await request(app)
      .post("/api/engine")
      .send({ url: "https://example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 403 with invalid API key", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", "sk_invalid00000000000000000000000000")
      .send({ url: "https://example.com" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when no url or google provided", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url.*google/i);
  });

  it("returns 403 with revoked key", async () => {
    const { apiKey } = createKey("revoke-engine");
    revokeKey(apiKey);
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it("accepts API key via Authorization Bearer header", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("authorization", `Bearer ${testKey}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects query-param API keys", async () => {
    const res = await request(app)
      .post(`/api/engine?apikey=${testKey}`)
      .send({});
    expect(res.status).toBe(401);
  });

  itLive("returns 200 for valid engine request (live)", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", format: "text", timeout: 15 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.output).toBe("string");
    expect(res.body.meta.type).toBe("page");
  }, 30000);

  itLive("returns 200 for search fallback (live)", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ query: "example test query", format: "text", googleCount: 3, timeout: 15 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.type).toBe("search");
    expect(res.body.meta.engineOrder.at(-1)).toBe("google");
  }, 30000);
});
