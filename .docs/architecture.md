# Insect Architecture

## Structure

```text
insect-js/
|-- insect-engine.js                # CLI entrypoint
|-- api.js                          # API server entrypoint
|-- server/
|   |-- index.js                    # Express app wiring + route mounting
|   |-- middleware/
|   |   `-- auth.js                 # API key auth middleware
|   |-- routes/
|   |   |-- engine.js               # POST /api/engine
|   |   |-- auth.js                 # Key management routes
|   |   `-- health.js               # GET /health
|   |-- core/
|   |   |-- engine.js               # Browser automation + extraction engine
|   |   |-- fingerprint.js          # Fingerprint pools and randomization
|   |   |-- formatters.js           # Output formatting utilities
|   |   |-- request.js              # Shared request normalization/validation
|   |   `-- search.js               # Search fallback orchestration
|   `-- db/
|       `-- keys.js                 # File-backed API key store
|-- packages/
|   `-- mcp/
|       |-- index.js                # MCP stdio server + tool definitions
|       `-- api-client.js           # MCP HTTP client + env config parsing
|-- scripts/                        # Bootstrap, deploy, smoke-test helpers
|-- tests/                          # Vitest suites (unit + integration + MCP)
|-- .docs/                          # Operational and architecture docs
`-- .refs/                          # External research/fork references
```

## Canonical Contracts

- `server/core/request.js` is the source of truth for request shape and guardrails.
- CLI (`insect-engine.js`) and API route (`server/routes/engine.js`) both rely on that shared validator.
- MCP tools call one hardened API client (`packages/mcp/api-client.js`) and return explicit tool errors.

## Runtime Modes

1. CLI mode (`node insect-engine.js ...`)
2. API mode (`node api.js`)
3. MCP mode (`node packages/mcp/index.js`)

All modes route through the same engine runtime and formatter stack.

## Data Flow

1. Input arrives from CLI, HTTP API, or MCP.
2. Input is normalized in `server/core/request.js`.
3. `server/core/engine.js` launches a fingerprinted browser session and extracts content.
4. Formatters convert data into the requested output format.
5. API and MCP return payload + metadata.

## Auth and Key Lifecycle

- API keys live in `data/keys.json`.
- Validation includes active/revoked/expired checks and per-key rate limiting.
- Search requests enforce a minimum six-second cooldown per key.
- Key writes use temp-file + rename for safer persistence.
- Admin routes are gated behind `ADMIN_KEY`.

## Testing Surface

- `npm test` runs the full Vitest matrix.
- `npm run test:mcp` isolates MCP API client + stdio startup coverage.
