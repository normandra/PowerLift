#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo "Creating Python virtualenv..."
  python3 -m venv .venv
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

PORT="${PORT:-8000}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo "========================================="
echo " PairLift is starting!"
echo " Local:   http://localhost:${PORT}"
if [ -n "$LAN_IP" ]; then
  echo " Wi-Fi:   http://${LAN_IP}:${PORT}"
fi
echo "========================================="

exec .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
