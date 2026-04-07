import { describe, expect, it } from "vitest";
import {
  RequestValidationError,
  normalizeEngineRequest,
} from "../server/core/request.js";

describe("normalizeEngineRequest()", () => {
  it("normalizes defaults for URL requests", () => {
    const normalized = normalizeEngineRequest({
      url: "https://example.com",
    });

    expect(normalized.url).toBe("https://example.com");
    expect(normalized.method).toBe("direct");
    expect(normalized.format).toBe("text");
    expect(normalized.timeout).toBe(30);
    expect(normalized.google).toBeUndefined();
    expect(normalized.searchEngines).toEqual(["duckduckgo", "bing", "brave", "google"]);
  });

  it("supports google-only requests", () => {
    const normalized = normalizeEngineRequest({
      google: "site:example.com crawler",
      googleCount: "5",
    });

    expect(normalized.google).toBe("site:example.com crawler");
    expect(normalized.query).toBe("site:example.com crawler");
    expect(normalized.url).toBeUndefined();
    expect(normalized.googleCount).toBe(5);
  });

  it("supports query alias and custom engine order with google forced last", () => {
    const normalized = normalizeEngineRequest({
      query: "insect crawler",
      searchEngines: "google,duckduckgo,bing",
    });

    expect(normalized.query).toBe("insect crawler");
    expect(normalized.google).toBe("insect crawler");
    expect(normalized.searchEngines).toEqual(["duckduckgo", "bing", "google"]);
  });

  it("throws on unknown search engine", () => {
    expect(() => normalizeEngineRequest({
      query: "crawler",
      searchEngines: "duckduckgo,unknown",
    })).toThrow(/searchEngines/i);
  });

  it("parses headers/cookies JSON from CLI strings", () => {
    const normalized = normalizeEngineRequest({
      url: "https://example.com",
      headers: "{\"x-test\":\"ok\"}",
      cookies: "[{\"name\":\"a\",\"value\":\"b\",\"domain\":\"example.com\"}]",
    });

    expect(normalized.headers).toEqual({ "x-test": "ok" });
    expect(Array.isArray(normalized.cookies)).toBe(true);
    expect(normalized.cookies[0].name).toBe("a");
  });

  it("forces headless=true when headful is disallowed", () => {
    const normalized = normalizeEngineRequest(
      {
        url: "https://example.com",
        "no-headless": true,
      },
      { allowHeadful: false },
    );

    expect(normalized.headless).toBe(true);
  });

  it("allows headful when explicitly enabled", () => {
    const normalized = normalizeEngineRequest(
      {
        url: "https://example.com",
        "no-headless": true,
      },
      { allowHeadful: true },
    );

    expect(normalized.headless).toBe(false);
  });

  it("throws on missing url/google", () => {
    expect(() => normalizeEngineRequest({})).toThrow(RequestValidationError);
  });

  it("throws when method=wait and selector is missing", () => {
    expect(() => normalizeEngineRequest({
      url: "https://example.com",
      method: "wait",
    })).toThrow(/selector/);
  });

  it("throws on invalid format", () => {
    expect(() => normalizeEngineRequest({
      url: "https://example.com",
      format: "bogus",
    })).toThrow(/Unknown format/);
  });

  it("throws when file outputs are requested from API mode", () => {
    expect(() => normalizeEngineRequest(
      {
        url: "https://example.com",
        screenshot: "capture.png",
      },
      { allowFileOutput: false },
    )).toThrow(/only supported for local CLI usage/);
  });
});
