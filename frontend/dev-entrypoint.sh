#!/bin/sh
set -eu

cd /app

# Only install when package.json changed since the last install.
# node_modules is a named Docker volume so it persists across restarts —
# this makes subsequent starts near-instant instead of reinstalling every time.
STAMP=/app/node_modules/.install-stamp
if [ ! -f "$STAMP" ] || [ /app/package.json -nt "$STAMP" ] || [ /app/package-lock.json -nt "$STAMP" ]; then
  echo "📦 Installing npm dependencies..."
  npm install
  touch "$STAMP"
else
  echo "📦 Dependencies up to date, skipping install"
fi

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
