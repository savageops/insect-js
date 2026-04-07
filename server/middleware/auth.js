import { validateKey } from "../db/keys.js";

function readApiKey(req) {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) return headerKey.trim();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    const bearerValue = authHeader.slice(7).trim();
    if (bearerValue) return bearerValue;
  }

  const queryValue = req.query?.apikey;
  if (typeof queryValue === "string" && queryValue.trim()) return queryValue.trim();
  return null;
}

function shouldEnforceSearchCooldown(req) {
  const query = req.body?.query ?? req.body?.google;
  return typeof query === "string" && query.trim().length > 0;
}

export function apiKeyAuth(req, res, next) {
  const key = readApiKey(req);

  if (!key) {
    return res.status(401).json({ error: "API key required. Pass x-api-key header or ?apikey= param." });
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
      cooldown: `Search cooldown active. Retry after ${result.retryAfter}s. Minimum ${result.cooldownSeconds || 6}s between search queries per API key.`,
    };
    const status = result.reason === "rate_limited" || result.reason === "cooldown" ? 429 : 403;
    return res.status(status).json({ error: messages[result.reason] || "Invalid API key." });
  }

  next();
}
