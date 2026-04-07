import { validateKey } from "../db/keys.js";
import { MIN_SEARCH_COOLDOWN_SECONDS } from "../core/contracts.js";

function firstHeaderValue(value) {
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

function readApiKey(req) {
  const headerKey = firstHeaderValue(req.headers["x-api-key"]);
  if (headerKey) return headerKey;

  const authHeader = firstHeaderValue(req.headers.authorization);
  if (authHeader) {
    const bearerMatch = authHeader.match(/^bearer\s+(.+)$/i);
    const bearerValue = bearerMatch?.[1]?.trim();
    if (bearerValue) return bearerValue;
  }
  return null;
}

function shouldEnforceSearchCooldown(req) {
  const query = req.body?.query ?? req.body?.google;
  return typeof query === "string" && query.trim().length > 0;
}

export function apiKeyAuth(req, res, next) {
  const key = readApiKey(req);

  if (!key) {
    return res.status(401).json({ error: "API key required. Pass x-api-key header or Authorization: Bearer <key>." });
  }

  const result = validateKey(key, {
    enforceSearchCooldown: shouldEnforceSearchCooldown(req),
  });

  if (!result.valid) {
    const messages = {
      not_found: "Invalid API key.",
      revoked: "API key has been revoked.",
      expired: "API key has expired.",
      rate_limited: `Rate limit exceeded. Retry after ${result.retryAfter}s.`,
      cooldown: `Search cooldown active. Retry after ${result.retryAfter}s. Minimum ${result.cooldownSeconds || MIN_SEARCH_COOLDOWN_SECONDS}s between search queries per API key.`,
    };
    const status = result.reason === "rate_limited" || result.reason === "cooldown" ? 429 : 403;
    return res.status(status).json({ error: messages[result.reason] || "Invalid API key." });
  }

  next();
}
