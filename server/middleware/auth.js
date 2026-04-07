import { validateKey } from "../db/keys.js";
import { MIN_SEARCH_COOLDOWN_SECONDS } from "../core/contracts.js";
import { firstHeaderValue, readBearerToken } from "../core/http-headers.js";

function readApiKey(req) {
  const headerKey = firstHeaderValue(req.headers["x-api-key"]);
  if (headerKey) return headerKey;

  const bearerValue = readBearerToken(req.headers.authorization);
  if (bearerValue) return bearerValue;
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
    return res.status(status).json({
      error: messages[result.reason] || "Invalid API key.",
      code: result.reason || "invalid_key",
      retryAfter: Number.isFinite(result.retryAfter) ? result.retryAfter : undefined,
      cooldownSeconds: Number.isFinite(result.cooldownSeconds)
        ? result.cooldownSeconds
        : (result.reason === "cooldown" ? MIN_SEARCH_COOLDOWN_SECONDS : undefined),
    });
  }

  next();
}
