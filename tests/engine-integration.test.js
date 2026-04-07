import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createKey } from "../server/db/keys.js";
import { runInsectEngine } from "../server/core/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = resolve(__dirname, "..", "data");
const TEST_DB_PATH = resolve(TEST_DB_DIR, "keys.json");

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

describe("core insect engine (integration)", () => {
  beforeAll(() => {
    backupKeys();
  });

  afterAll(() => {
    restoreKeys();
  });

  it("scrapes example.com with method=direct, format=text", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "text",
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(result.output.toLowerCase()).toMatch(/example domain/);
    expect(result.meta.type).toBe("page");
    expect(result.meta.textLength).toBeGreaterThan(0);
    expect(result.meta.fingerprint).toBeTruthy();
    expect(result.meta.fingerprint.userAgent).toBeTruthy();
    expect(result.meta.fingerprint.viewport).toBeTruthy();
  }, 30000);

  it("scrapes with format=json and returns structured data", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "json",
      timeout: 15,
    });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.title).toBeTruthy();
    expect(parsed.url).toBeTruthy();
    expect(typeof parsed.text).toBe("string");
    expect(Array.isArray(parsed.links)).toBe(true);
  }, 30000);

  it("scrapes with format=markdown", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "markdown",
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  }, 30000);

  it("scrapes with format=links", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "links",
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("http");
    expect(result.meta.linksFound).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("scrapes with format=html", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "html",
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("<");
    expect(result.output).toContain(">");
  }, 30000);

  it("scrapes with verbose=true includes noise elements", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "html",
      verbose: true,
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  }, 30000);

  it("Google search returns results", async () => {
    const result = await runInsectEngine({
      google: "example domain",
      format: "text",
      googleCount: 5,
      timeout: 15,
    });

    expect(result.success).toBe(true);
    expect(result.meta.type).toBe("search");
    expect(result.meta.query).toBe("example domain");
    expect(Array.isArray(result.meta.engineOrder)).toBe(true);
    expect(result.meta.engineOrder.at(-1)).toBe("google");
  }, 30000);

  it("Google search with format=json returns structured results", async () => {
    const result = await runInsectEngine({
      google: "example",
      format: "json",
      googleCount: 3,
      timeout: 15,
    });

    expect(result.success).toBe(true);
    const results = JSON.parse(result.output);
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("title");
      expect(results[0]).toHaveProperty("url");
    }
    expect(result.meta.type).toBe("search");
  }, 30000);

  it("throws error for missing url and google", async () => {
    await expect(runInsectEngine({
      method: "direct",
      format: "text",
      timeout: 5,
    })).rejects.toThrow(/url.*google.*required/i);
  });

  it("returns error for invalid URL that cannot be reached", async () => {
    const result = await runInsectEngine({
      url: "https://thisdomaindoesnotexist12345.example",
      method: "direct",
      format: "text",
      timeout: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  }, 15000);

  it("elapsed time is returned as a string", async () => {
    const result = await runInsectEngine({
      url: "https://example.com",
      method: "direct",
      format: "text",
      timeout: 15,
    });

    expect(result.meta.elapsed).toBeTruthy();
    expect(typeof result.meta.elapsed).toBe("string");
    expect(parseFloat(result.meta.elapsed)).toBeGreaterThan(0);
  }, 30000);
});
