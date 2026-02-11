#!/bin/sh
set -eu

cd /app

npm ci

npm run panda:generate

npm run panda:codegen:watch &
PANDA_CODEGEN_PID=$!

npm run panda:css:watch &
PANDA_CSS_PID=$!

cleanup() {
  kill "$PANDA_CODEGEN_PID" "$PANDA_CSS_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

npm run dev -- --host 0.0.0.0 --port 5173
