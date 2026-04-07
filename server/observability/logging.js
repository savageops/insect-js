function round(value) {
  return Math.round(value * 100) / 100;
}

export function logEvent(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: "info",
    event,
    ...fields,
  };

  if (typeof payload.duration_ms === "number") {
    payload.duration_ms = round(payload.duration_ms);
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function logError(event, error, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level: "error",
    event,
    message: error?.message || String(error),
    ...fields,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
}
