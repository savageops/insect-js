#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage: bash scripts/start-api.sh

Starts the Insect API from the repository root using current environment.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required." >&2
  exit 1
fi

if [[ "${NODE_ENV:-}" == "production" && -z "${ADMIN_KEY:-}" ]]; then
  echo "Error: ADMIN_KEY must be set when NODE_ENV=production." >&2
  exit 1
fi

cd "$ROOT_DIR"
mkdir -p data

echo "[start-api] Starting Insect API..."
exec node api.js
