import { describe, expect, it } from "vitest";
import {
  MCP_CONFIG_EXAMPLE,
  createApiClient,
  readMcpConfig,
} from "../packages/mcp/api-client.js";

describe("packages/mcp/api-client", () => {
  it("reads env config with defaults", () => {
    const config = readMcpConfig({
      INSECT_API_KEY: "sk_test",
    });

    expect(config.apiBase).toBe("http://localhost:3000");
    expect(config.apiKey).toBe("sk_test");
    expect(MCP_CONFIG_EXAMPLE.mcpServers.insect).toBeTruthy();
  });

  it("returns ok payload for successful API responses", async () => {
    const client = createApiClient({
      apiBase: "http://localhost:3000",
      apiKey: "sk_test",
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, output: "ok" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    });

    const result = await client.postJson("/api/engine", { url: "https://example.com" });
    expect(result.ok).toBe(true);
    expect(result.payload.success).toBe(true);
  });

  it("returns structured API error for non-2xx json response", async () => {
    const client = createApiClient({
      apiBase: "http://localhost:3000",
      apiKey: "sk_test",
      fetchImpl: async () => new Response(
        JSON.stringify({ error: "bad key" }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    });

    const result = await client.postJson("/api/engine", {});
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/API Error 403/);
    expect(result.errorMessage).toMatch(/bad key/);
  });

  it("handles non-json error responses", async () => {
    const client = createApiClient({
      apiBase: "http://localhost:3000",
      apiKey: "sk_test",
      fetchImpl: async () => new Response("upstream unavailable", { status: 502 }),
    });

    const result = await client.postJson("/api/engine", {});
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/upstream unavailable/);
  });

  it("handles thrown network errors", async () => {
    const client = createApiClient({
      apiBase: "http://localhost:3000",
      apiKey: "sk_test",
      fetchImpl: async () => {
        throw new Error("ENOTFOUND");
      },
    });

    const result = await client.postJson("/api/engine", {});
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/ENOTFOUND/);
  });

  it("handles timeout aborts", async () => {
    const client = createApiClient({
      apiBase: "http://localhost:3000",
      apiKey: "sk_test",
      timeoutMs: 10,
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      }),
    });

    const result = await client.postJson("/api/engine", {});
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toMatch(/timed out/i);
  });
});
