#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root="$(cd "$script_dir/.." && pwd)"
bundled_binary="$skill_root/assets/bin/insect-rs.exe"
binary="${INSECT_RS_BIN:-$bundled_binary}"

if [[ ! -f "$binary" ]]; then
  echo "insect-rs.exe not found. Expected $bundled_binary or set INSECT_RS_BIN." >&2
  exit 1
fi

exec "$binary" "$@"
