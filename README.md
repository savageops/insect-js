# insect-js

```text
8888888 888b    888  .d8888b.  8888888888 .d8888b. 88888888888
  888   8888b   888 d88P  Y88b 888       d88P  Y88b    888    
  888   88888b  888 Y88b.      888       888    888    888    
  888   888Y88b 888  "Y888b.   8888888   888           888    
  888   888 Y88b888     "Y88b. 888       888           888    
  888   888  Y88888       "888 888       888    888    888    
  888   888   Y8888 Y88b  d88P 888       Y88b  d88P    888    
8888888 888    Y888  "Y8888P"  8888888888 "Y8888P"     888
```

**Programmable web retrieval infrastructure for AI products and data platforms.**

`insect-js` is an API-first crawling and SERP extraction stack for teams that want to own web retrieval.

## What It Solves

Web retrieval fails in production for predictable reasons: brittle selectors, engine blocking, weak tenancy controls, and inconsistent contracts across tools.

Insect ships a single runtime and request contract across:
- CLI (`insect-engine.js`)
- HTTP API (`/api/engine`)
- Transcript API (`/api/youtube/transcript`)
- MCP server (`packages/mcp`)

## Product Surface (Current)

- Browser-based extraction with rotating fingerprint profiles.
- Multi-engine search fallback with deterministic order enforcement.
- Google always forced to the final fallback attempt.
- YouTube transcript fallback adapter chain (`insect_native -> insect_signal -> invidious -> piped -> yt_dlp`).
- Per-key authorization, rate limiting, and minimum 6s search cooldown.
- Structured key lifecycle endpoints (`create`, `list`, `inspect`, `revoke`).
- MCP tool descriptors aligned to API behavior for agent workflows.

## Architecture

```mermaid
flowchart LR
    A["CLI Clients"] --> D["Request Normalization (`server/core/request.js`)"]
    B["API Clients"] --> C["Express API (`/api/engine`)"]
    B --> T["Transcript API (`/api/youtube/transcript`)"]
    G["MCP Clients"] --> H["MCP Server (`packages/mcp`)"]
    H --> C
    H --> T
    C --> E["Auth + Key State (`server/db/keys.js`)"]
    T --> E
    C --> D
    T --> Y["Transcript Adapter Engine (`server/core/youtube-transcript.js`)"]
    D --> F["Engine Runtime (`server/core/engine.js`)"]
    F --> S["Search Router (`server/core/search.js`)"]
    S --> S1["DuckDuckGo"]
    S --> S2["Bing"]
    S --> S3["Brave"]
    S --> S4["Google (forced last)"]
    Y --> Y1["insect_native"]
    Y --> Y2["insect_signal"]
    Y --> Y3["invidious"]
    Y --> Y4["piped"]
    Y --> Y5["yt_dlp"]
```

## Operational Controls

- Search requests enforce a hard minimum `6s` cooldown per API key (`429` on violation).
- Rate limits are enforced per key over a rolling minute window.
- Request validation is centralized, reducing contract drift across CLI/API/MCP.
- Error codes are explicit for upstream and browser-launch failure classes.
- API key auth is header-only (`x-api-key` or `Authorization: Bearer <key>`).

## Quick Start

```bash
bash scripts/bootstrap.sh --install-browser
bash scripts/start-api.sh
```

Create an API key:

```bash
bash scripts/create-api-key.sh \
  --admin-key admin_change_me \
  --label local-dev \
  --rate-limit 120 \
  --search-cooldown 6
```

Run a smoke test:

```bash
bash scripts/smoke-test.sh --base-url http://localhost:3000 --api-key sk_xxx
```

## API Example

```bash
curl -sS http://localhost:3000/api/engine \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_xxx" \
  -d '{
    "query":"open source crawler frameworks",
    "googleCount":10,
    "searchEngines":["duckduckgo","bing","brave","google"],
    "format":"json"
  }'
```

YouTube transcript example:

```bash
curl -sS http://localhost:3000/api/youtube/transcript \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_xxx" \
  -d '{
    "url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "language":"en",
    "format":"json",
    "methods":["insect_native","insect_signal","invidious","piped","yt_dlp"]
  }'
```

## MCP Integration

```bash
export INSECT_API_URL=http://localhost:3000
export INSECT_API_KEY=sk_xxx
npm run mcp
```

Optional transcript adapter tuning:

```bash
export INSECT_INVIDIOUS_INSTANCES=https://invidious.nerdvpn.de,https://yewtu.be
export INSECT_PIPED_INSTANCES=https://pipedapi.kavin.rocks,https://pipedapi.adminforge.de
export INSECT_YTDLP_COMMANDS=yt-dlp,yt-dlp.exe
```

Transcript MCP tool:

- `transcribe-youtube`

Generate an MCP config snippet:

```bash
bash scripts/render-mcp-config.sh \
  --api-url https://api.yourdomain.com \
  --api-key sk_xxx
```

## Deploy as SaaS

```bash
bash scripts/deploy-saas-host.sh \
  --repo-dir /opt/insect \
  --admin-key "replace-with-strong-secret" \
  --port 3000 \
  --service-user "$USER"
```

## Validation

```bash
npm test
npm run test:mcp
npm run test:live
```

## Repository Layout

```text
.
|-- api.js
|-- insect-engine.js
|-- server/
|   |-- core/
|   |-- routes/
|   |-- middleware/
|   `-- db/
|-- packages/
|   `-- mcp/
|-- scripts/
|-- tests/
|-- .docs/
|-- .refs/
|-- CONTRIBUTING.md
|-- ONBOARDING.md
`-- DEPLOYMENT-SAAS.md
```

## Docs

- [Onboarding](./ONBOARDING.md)
- [Contributing](./CONTRIBUTING.md)
- [SaaS Deployment](./DEPLOYMENT-SAAS.md)
- [Architecture Deep Dive](./.docs/architecture.md)
- [API Reference](./.docs/api-reference.md)
- [Production Readiness](./.docs/production-readiness.md)

## License

MIT - see [LICENSE](./LICENSE).

## Engine Backlog

Future candidates (not enabled yet): `yahoo`, `yandex`, `startpage`, `ecosia`, `qwant`, `mojeek`, `kagi`.
