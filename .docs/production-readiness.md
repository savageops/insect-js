# Insect Production Readiness Report

## Objective

Keep CLI, API, and MCP on one hardened engine contract, minimize drift risk, and preserve deterministic behavior under production load.

## What Is Standardized

### 1. One canonical request contract

`server/core/request.js` owns:

- input normalization
- type coercion
- numeric guardrails (`timeout`, `scrollCount`, `scrollDelay`, `delay`, `googleCount`)
- search engine order normalization with Google forced last
- method/format validation
- selector requirement for `method=wait`
- URL validation
- CLI-only artifact controls (`screenshot`, `pdf`)

Shared by:

- CLI entry (`insect-engine.js`)
- API route (`server/routes/engine.js`)
- Engine runtime (`server/core/engine.js`)

### 2. CLI/API parity

`insect-engine.js` runs the same runtime pipeline as the API endpoint.

Result:

- lower maintenance surface
- no duplicate constants
- no split behavior between modes

### 3. API error determinism

`POST /api/engine` maps failures into stable classes:

- `400` validation (`VALIDATION_ERROR`)
- `502` upstream navigation/extraction failure (`UPSTREAM_REQUEST`)
- `503` browser launch failure (`BROWSER_LAUNCH`)

### 4. Key-store durability and abuse controls

`server/db/keys.js` includes:

- temp-file + rename writes
- rate-limit normalization with bounded defaults
- per-key search cooldown (minimum six seconds)
- expiry metadata (`expiredAt`)
- normalized key creation parameters

### 5. MCP hardening

`packages/mcp/api-client.js` includes:

- deterministic timeout handling
- robust JSON/non-JSON error parsing
- consistent MCP error envelope output
- env config via:
  - `INSECT_API_URL`
  - `INSECT_API_KEY`

`packages/mcp/index.js` uses that client and exposes engine-aligned tools.

## Verification Matrix

Recommended checks:

- `npm test`
- `npm run test:mcp`
- MCP stdio smoke:
  - `INSECT_API_KEY=sk_test`
  - `INSECT_API_URL=http://127.0.0.1:3000`
  - `node packages/mcp/index.js`

## Operational Notes

- Production must set `ADMIN_KEY` explicitly.
- Maintain one external engine endpoint (`POST /api/engine`) to avoid contract split.
- Preserve request contract parity when adding new engine capability.
