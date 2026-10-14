#!/usr/bin/env bash
# One-command dev run: FastAPI (hot reload, :8000) + Vite (HMR, :5173).
# Open http://localhost:5173
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt
[ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund)
[ -f .env ] && set -a && . ./.env && set +a

.venv/bin/uvicorn backend.app:app --reload --reload-dir backend --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT INT TERM
(cd frontend && npm run dev -- --host)
