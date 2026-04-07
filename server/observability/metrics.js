const LATENCY_WINDOW_SIZE = 500;

const counters = {
  success: 0,
  blocked: 0,
  fallbackDepthSum: 0,
  fallbackDepthSamples: 0,
  status429: 0,
};

const latencySamplesMs = [];

function pushLatencySample(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  latencySamplesMs.push(durationMs);
  if (latencySamplesMs.length > LATENCY_WINDOW_SIZE) {
    latencySamplesMs.shift();
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

function fallbackDepthFromAttempts(attempts) {
  const successIndex = attempts.findIndex((attempt) => attempt.reason === "ok" || attempt.resultCount > 0);
  if (successIndex >= 0) return successIndex;
  return Math.max(0, attempts.length - 1);
}

export function recordHttpResponse({ statusCode, durationMs }) {
  if (statusCode === 429) counters.status429 += 1;
  pushLatencySample(durationMs);
}

export function recordEngineOutcome(result) {
  if (!result?.success) return;
  counters.success += 1;

  const attempts = result?.meta?.attempts;
  if (!Array.isArray(attempts) || attempts.length === 0) return;

  for (const attempt of attempts) {
    if (attempt?.blocked || attempt?.reason === "blocked") {
      counters.blocked += 1;
    }
  }

  counters.fallbackDepthSamples += 1;
  counters.fallbackDepthSum += fallbackDepthFromAttempts(attempts);
}

export function getObservabilitySnapshot() {
  return {
    success: counters.success,
    blocked: counters.blocked,
    fallback_depth: counters.fallbackDepthSamples === 0
      ? 0
      : Math.round((counters.fallbackDepthSum / counters.fallbackDepthSamples) * 100) / 100,
    p95: percentile(latencySamplesMs, 95),
    "429s": counters.status429,
  };
}

export function resetObservabilityForTests() {
  counters.success = 0;
  counters.blocked = 0;
  counters.fallbackDepthSum = 0;
  counters.fallbackDepthSamples = 0;
  counters.status429 = 0;
  latencySamplesMs.length = 0;
}
