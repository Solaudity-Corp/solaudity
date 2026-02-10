#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$PROJECT_ROOT/.run"
LOG_DIR="$PROJECT_ROOT/.logs"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$PROJECT_ROOT/data"

# Detect docker compose command (new: `docker compose`, old: `docker-compose`)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "[-] Docker Compose not found. Install Docker Desktop / docker-compose."
  exit 1
fi

# Check npm exists
command -v npm >/dev/null 2>&1 || { echo "[-] npm not found. Install Node.js/npm."; exit 1; }

echo "[+] Starting backend (Docker Compose)"
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" up -d --build

# Install frontend deps if missing
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "[+] Installing frontend dependencies"
  (cd "$FRONTEND_DIR" && npm install)
fi

# If frontend already running, don't start again
if [ -f "$FRONTEND_PID_FILE" ]; then
  OLD_PID="$(cat "$FRONTEND_PID_FILE" || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "[i] Frontend already running (PID: $OLD_PID)"
    echo "[i] Backend:  http://localhost:8001"
    echo "[i] Frontend: http://localhost:5173"
    exit 0
  else
    rm -f "$FRONTEND_PID_FILE"
  fi
fi

echo "[+] Starting frontend (background)"
# Use nohup so it keeps running after terminal closes
# Log output to .logs/frontend.log
nohup bash -lc "cd '$FRONTEND_DIR' && npm run dev -- --host" \
  > "$LOG_DIR/frontend.log" 2>&1 &

FRONT_PID="$!"
echo "$FRONT_PID" > "$FRONTEND_PID_FILE"

echo "[+] Started"
echo "[i] Backend:  http://localhost:8001"
echo "[i] Frontend: http://localhost:5173"
echo "[i] Frontend logs: $LOG_DIR/frontend.log"
