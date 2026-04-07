export function firstHeaderValue(value) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const normalized = item.trim();
      if (normalized.length > 0) return normalized;
    }
  }
  return null;
}

export function readBearerToken(value) {
  const headerValue = firstHeaderValue(value);
  if (!headerValue) return null;
  const bearerMatch = headerValue.match(/^bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || null;
}
