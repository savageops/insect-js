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
|   |   |-- youtube-transcript.js   # POST /api/youtube/transcript
|   |   |-- auth.js                 # Key management routes
|   |   `-- health.js               # GET /health
|   |-- core/
|   |   |-- engine.js               # Browser automation + extraction engine
|   |   |-- youtube-transcript.js   # Adapter fallback chain for YouTube transcripts
|   |   |-- fingerprint.js          # Fingerprint pools and randomization
|   |   |-- formatters.js           # Output formatting utilities
|   |   |-- request.js              # Shared request normalization/validation
|   |   |-- search.js               # Search fallback orchestration
|   |   `-- contracts.js            # Canonical API paths and cooldown constants
|   `-- db/
|       `-- keys.js                 # SQLite WAL API key store
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
- `server/core/youtube-transcript.js` is the request + execution contract for transcript fallback flows.
- `server/core/contracts.js` carries canonical API paths and the minimum search cooldown.
- CLI (`insect-engine.js`) and API route (`server/routes/engine.js`) both rely on the shared engine validator.
- MCP tools call one hardened API client (`packages/mcp/api-client.js`) and return explicit tool errors.

## Runtime Modes

1. CLI mode (`node insect-engine.js ...`)
2. API mode (`node api.js`) for extraction and transcript endpoints
3. MCP mode (`node packages/mcp/index.js`)

Engine flows route through `server/core/engine.js`.
Transcript flows route through `server/core/youtube-transcript.js`.

## Data Flow

1. Input arrives from CLI, HTTP API, or MCP.
2. Engine input is normalized in `server/core/request.js`.
3. `server/core/engine.js` launches a fingerprinted browser session and extracts content.
4. Transcript input is normalized and routed through `server/core/youtube-transcript.js`.
5. API and MCP return payload + metadata.

## Auth and Key Lifecycle

- API keys live in `data/keys.sqlite`.
- Validation includes active/revoked/expired checks and per-key rate limiting.
- Search requests enforce a minimum six-second cooldown per key.
- SQLite WAL is enabled for safer write durability and concurrent request handling.
- Admin routes are gated behind `ADMIN_KEY`.

## Testing Surface

- `npm test` runs the full Vitest matrix.
- `npm run test:mcp` isolates MCP API client + stdio startup coverage.
- `npm run test:live` enables opt-in live browser/network coverage.
