#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PORT="${PORT:-8000}"

echo "Starting the REDLINE planner and viewer server on port ${PORT} ..."
echo "The first start builds the release binary."
echo
exec cargo run --release -- --serve "$PORT" "$@"
