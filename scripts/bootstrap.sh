#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_BROWSER=0

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap.sh [--install-browser]

Options:
  --install-browser   Download Chromium used by Puppeteer
  -h, --help          Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-browser)
      INSTALL_BROWSER=1
      shift
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

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required." >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "[bootstrap] Installing root dependencies..."
npm install

echo "[bootstrap] Installing MCP package dependencies..."
(
  cd packages/mcp
  npm install
)

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  echo "[bootstrap] Created .env from .env.example"
fi

if [[ "$INSTALL_BROWSER" -eq 1 ]]; then
  echo "[bootstrap] Installing browser binary..."
  npm run install-browser
fi

echo "[bootstrap] Done."
