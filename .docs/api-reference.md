# Insect API Reference

## Environment

- `PORT` (default `3000`)
- `ADMIN_KEY` (required in production; dev default `admin_change_me`)
- `INSECT_API_URL` (MCP client target, default `http://localhost:3000`)
- `INSECT_API_KEY` (required by MCP server)

## Authentication

`POST /api/engine` accepts API keys from:

- `x-api-key` header
- `Authorization: Bearer <key>`
- `?apikey=<key>` query param

Admin routes under `/api/keys` require:

- `x-admin-key` header
- or `Authorization: Bearer <admin-key>`
- or `?adminkey=<admin-key>`

## Endpoints

### `GET /health`

Returns service health and runtime info.

### `POST /api/engine`

Run the Insect engine against a URL or execute multi-engine search.

Supported fields:

- `url` string (required unless `google` or `query`)
- `google` string (legacy alias for `query`)
- `query` string (required unless `url`)
- `method` one of `direct|wait|scroll|timed|spa`
- `format` one of `text|html|markdown|json|links`
- `verbose` boolean
- `selector` string (required when `method=wait` and search query is not used)
- `timeout` integer `1..180`
- `scrollCount` integer `1..500`
- `scrollDelay` integer `50..10000`
- `delay` integer `0..30000`
- `googleCount` integer `1..50` (max results for search mode)
- `searchEngines` string array or CSV list (`duckduckgo|bing|brave|google`)
- `searchEngines` always forces Google to the final attempt when included
- `proxy` string
- `cookies` array or JSON string
- `headers` object or JSON string

Error contract:

- `400` validation failure (`code: "VALIDATION_ERROR"`)
- `403` invalid/revoked key
- `429` rate-limited key or search cooldown violation
- `502` upstream navigation/extraction failure (`code: "UPSTREAM_REQUEST"`)
- `503` browser launch failure (`code: "BROWSER_LAUNCH"`)

### `POST /api/keys/create`

Creates a key.

Body:

- `label` string (default `unnamed`)
- `rateLimit` integer (`1..10000`, default `100`)
- `searchCooldownSeconds` integer (`>=6`, default `6`)
- `expiresIn` integer seconds (`>0`) or `null`

### `GET /api/keys`

Lists masked key records.

### `GET /api/keys/:key`

Returns masked details for one key.

### `DELETE /api/keys/:key`

Revokes a key.

## MCP Tools

The MCP server exposes:

- `run-engine`
- `engine-search`
- `search-web`
- `extract-links`
- `engine-page-metadata`

All tools call the same `POST /api/engine` API endpoint via `packages/mcp/api-client.js`.
Search tools state the 6 second per-key cooldown and Google-last fallback order in their descriptors.

## Test Commands

- `npm test` - full Vitest matrix
- `npm run test:mcp` - MCP client + stdio smoke tests
