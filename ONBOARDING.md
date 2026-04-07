# Insect Onboarding and Setup Guide

## Who This Guide Is For

Anyone who needs to run, develop, or integrate Insect:

- backend/API maintainers
- MCP/tooling integrators
- operators hosting Insect as a SaaS API

## Prerequisites

- Node.js 20+
- npm 10+
- Bash shell for scripts
- Network access for target pages you scrape

## Fastest Setup Path

```bash
bash scripts/bootstrap.sh --install-browser
```

What this does:

- installs root dependencies
- installs `packages/mcp` dependencies
- optionally downloads Chromium for Puppeteer
- creates `.env` from `.env.example` if missing

## Manual Setup Path

```bash
npm install
cd packages/mcp && npm install && cd ../..
npm run install-browser
cp .env.example .env
```

## Start the API

```bash
bash scripts/start-api.sh
```

Default API URL:

- `http://localhost:3000`

## Create an API Key

```bash
bash scripts/create-api-key.sh \
  --admin-key admin_change_me \
  --label onboarding-user \
  --rate-limit 120 \
  --search-cooldown 6
```

## Validate Connectivity

```bash
bash scripts/smoke-test.sh --base-url http://localhost:3000 --api-key sk_xxx
```

This checks:

- `/health`
- authenticated `/api/engine`

## Run the MCP Server

Set env first:

```bash
export INSECT_API_URL=http://localhost:3000
export INSECT_API_KEY=sk_xxx
```

Then run:

```bash
npm run mcp
```

You should see:

- `insect MCP server running on stdio`

## Generate MCP Client Config

```bash
bash scripts/render-mcp-config.sh \
  --api-url https://api.yourdomain.com \
  --api-key sk_xxx
```

## Run Tests

```bash
npm test
npm run test:mcp
```

## Common Troubleshooting

1. Browser launch fails
- Run: `npm run install-browser`

2. `403` on engine API
- Check your `x-api-key` value
- Ensure the key is active and not rate-limited

3. `429` on search requests
- Search mode enforces a minimum 6 second cooldown per key
- Wait for the retry window from the response and retry

4. MCP exits immediately
- Verify `INSECT_API_KEY` is set
- Verify API is reachable from your MCP runtime environment

5. Admin key routes failing
- Check `ADMIN_KEY` in `.env` and request header `x-admin-key`
