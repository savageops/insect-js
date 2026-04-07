#!/usr/bin/env bash
set -euo pipefail

BASE_URL="http://localhost:3000"
ADMIN_KEY="${ADMIN_KEY:-}"
LABEL="api-user"
RATE_LIMIT="100"
SEARCH_COOLDOWN_SECONDS="6"
EXPIRES_IN=""

usage() {
  cat <<'EOF'
Usage: bash scripts/create-api-key.sh --admin-key <key> [options]

Options:
  --admin-key <key>      Admin key required for /api/keys/create
  --base-url <url>       API base URL (default: http://localhost:3000)
  --label <value>        Label for key metadata (default: api-user)
  --rate-limit <value>   Requests per minute (default: 100)
  --search-cooldown <s>  Minimum seconds between search queries (default: 6)
  --expires-in <seconds> Optional key expiry in seconds
  -h, --help             Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --admin-key)
      ADMIN_KEY="${2:-}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --rate-limit)
      RATE_LIMIT="${2:-}"
      shift 2
      ;;
    --search-cooldown)
      SEARCH_COOLDOWN_SECONDS="${2:-}"
      shift 2
      ;;
    --expires-in)
      EXPIRES_IN="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ADMIN_KEY" ]]; then
  echo "Error: --admin-key is required (or set ADMIN_KEY env var)." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

PAYLOAD="$(node -e '
const [label, rateLimit, expiresIn, searchCooldownSeconds] = process.argv.slice(1);
const parsedRate = Number(rateLimit);
const parsedExpires = expiresIn === "" ? null : Number(expiresIn);
const parsedCooldown = Number(searchCooldownSeconds);
const body = {
  label,
  rateLimit: parsedRate,
  searchCooldownSeconds: Number.isFinite(parsedCooldown) ? parsedCooldown : 6,
  expiresIn: Number.isFinite(parsedExpires) ? parsedExpires : null,
};
console.log(JSON.stringify(body));
' "$LABEL" "$RATE_LIMIT" "$EXPIRES_IN" "$SEARCH_COOLDOWN_SECONDS")"

echo "[create-api-key] Creating API key at ${BASE_URL}..."
curl -sS -X POST "${BASE_URL}/api/keys/create" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: ${ADMIN_KEY}" \
  -d "${PAYLOAD}"
echo
