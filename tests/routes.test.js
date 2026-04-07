import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../server/index.js";
import { createKey, revokeKey } from "../server/db/keys.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = resolve(__dirname, "..", "data");
const TEST_DB_PATH = resolve(TEST_DB_DIR, "keys.json");
const ADMIN_KEY = "admin_change_me";

let originalData = null;

function backupKeys() {
  if (existsSync(TEST_DB_PATH)) {
    originalData = readFileSync(TEST_DB_PATH, "utf-8");
    rmSync(TEST_DB_PATH);
  } else {
    originalData = null;
  }
}

function restoreKeys() {
  if (existsSync(TEST_DB_PATH)) {
    rmSync(TEST_DB_PATH);
  }
  if (originalData !== null) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    writeFileSync(TEST_DB_PATH, originalData, "utf-8");
  }
}

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("insect");
    expect(res.body.version).toBe("1.0.0");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("returns memory info", async () => {
    const res = await request(app).get("/health");
    expect(res.body.memory).toBeTruthy();
    expect(res.body.memory.rss).toBeGreaterThan(0);
  });
});

describe("POST /api/keys (admin routes)", () => {
  beforeEach(() => {
    backupKeys();
  });

  afterEach(() => {
    restoreKeys();
  });

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

  it("creates a key via query param", async () => {
    const res = await request(app)
      .post("/api/keys/create?adminkey=" + ADMIN_KEY)
      .send({ label: "query-admin" });
    expect(res.status).toBe(201);
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

  it("uses default label when not provided", async () => {
    const res = await request(app)
      .post("/api/keys/create")
      .set("x-admin-key", ADMIN_KEY)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.label).toBe("unnamed");
  });

  it("lists all keys", async () => {
    await createKey("list-test-1");
    await createKey("list-test-2");
    const res = await request(app)
      .get("/api/keys")
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(2);
  });

  it("gets info for a specific key", async () => {
    const { apiKey } = createKey("info-route");
    const res = await request(app)
      .get(`/api/keys/${apiKey}`)
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("info-route");
  });

  it("returns 404 for non-existent key info", async () => {
    const res = await request(app)
      .get("/api/keys/sk_nonexistent00000000000000000000000")
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(404);
  });

  it("deletes/revokes a key", async () => {
    const { apiKey } = createKey("delete-me");
    const res = await request(app)
      .delete(`/api/keys/${apiKey}`)
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
  });

  it("returns 404 when deleting non-existent key", async () => {
    const res = await request(app)
      .delete("/api/keys/sk_nonexistent00000000000000000000000")
      .set("x-admin-key", ADMIN_KEY);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/engine", () => {
  let testKey;

  beforeAll(() => {
    backupKeys();
    const result = createKey("engine-test");
    testKey = result.apiKey;
  });

  afterAll(() => {
    restoreKeys();
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

  it("returns 400 for invalid method", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", method: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown method/);
  });

  it("returns 400 for invalid format", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", format: "invalid" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown format/);
  });

  it("returns 403 with revoked key", async () => {
    const { apiKey } = createKey("revoke-engine");
    revokeKey(apiKey);
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", apiKey)
      .send({ url: "https://example.com" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/revoked/);
  });

  it("accepts API key via Authorization Bearer header", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("authorization", `Bearer ${testKey}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("accepts API key via query param", async () => {
    const res = await request(app)
      .post(`/api/engine?apikey=${testKey}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 200 for valid engine request (live, may be slow)", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", format: "text", timeout: 15 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.output).toBe("string");
    expect(res.body.output.length).toBeGreaterThan(0);
    expect(res.body.meta).toBeTruthy();
    expect(res.body.meta.type).toBe("page");
  }, 30000);

  it("returns 200 for Google search (live, may be slow)", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ google: "example test query", format: "text", googleCount: 3, timeout: 15 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.type).toBe("search");
    expect(res.body.meta.query).toBe("example test query");
    expect(res.body.meta.engineOrder.at(-1)).toBe("google");
  }, 30000);

  it("returns JSON format with structured data", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", format: "json", timeout: 15 });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body.output);
    expect(parsed.title).toBeTruthy();
    expect(parsed.url).toBe("https://example.com/");
  }, 30000);

  it("returns links format", async () => {
    const res = await request(app)
      .post("/api/engine")
      .set("x-api-key", testKey)
      .send({ url: "https://example.com", format: "links", timeout: 15 });
    expect(res.status).toBe(200);
    expect(res.body.output).toContain("http");
  }, 30000);
});
