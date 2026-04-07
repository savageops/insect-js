import { describe, it, expect, beforeEach } from "vitest";
import {
  getObservabilitySnapshot,
  recordHttpResponse,
  recordEngineOutcome,
  resetObservabilityForTests,
} from "../server/observability/metrics.js";

describe("server/observability/metrics.js", () => {
  beforeEach(() => {
    resetObservabilityForTests();
  });

  it("tracks success, blocked attempts, fallback depth, p95, and 429s", () => {
    recordHttpResponse({ statusCode: 200, durationMs: 50 });
    recordHttpResponse({ statusCode: 429, durationMs: 120 });
    recordHttpResponse({ statusCode: 200, durationMs: 80 });

    recordEngineOutcome({
      success: true,
      meta: {
        attempts: [
          { engine: "duckduckgo", reason: "blocked", resultCount: 0 },
          { engine: "bing", reason: "ok", resultCount: 3 },
        ],
      },
    });

    const snapshot = getObservabilitySnapshot();
    expect(snapshot.success).toBe(1);
    expect(snapshot.blocked).toBe(1);
    expect(snapshot.fallback_depth).toBe(1);
    expect(snapshot.p95).toBeGreaterThanOrEqual(120);
    expect(snapshot["429s"]).toBe(1);
  });
});
