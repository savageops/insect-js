#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUST_ROOT="${REPO_ROOT}/rust"

cd "${RUST_ROOT}"
cargo check
cargo test -- --test-threads=1
