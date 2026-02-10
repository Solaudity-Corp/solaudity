#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$PROJECT_ROOT/.run"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

# Detect docker compose command
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  DOCKER_COMPOSE=()
fi

echo "[+] Stopping solaudity"

# Stop frontend if running
if [ -f "$FRONTEND_PID_FILE" ]; then
  PID="$(cat "$FRONTEND_PID_FILE" || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
    echo "[+] Stopping frontend (PID: $PID)"
    kill "$PID" || true

    # Wait up to ~5s, then force kill
    for _ in {1..10}; do
      if kill -0 "$PID" >/dev/null 2>&1; then
        sleep 0.5
      else
        break
      fi
    done

    if kill -0 "$PID" >/dev/null 2>&1; then
      echo "[!] Frontend did not stop gracefully, forcing kill"
      kill -9 "$PID" || true
    fi
  else
    echo "[i] Frontend not running (stale PID file)"
  fi
  rm -f "$FRONTEND_PID_FILE"
else
  echo "[i] No frontend PID file found"
fi

# Stop backend containers
if [ "${#DOCKER_COMPOSE[@]}" -gt 0 ]; then
  echo "[+] Stopping backend (Docker Compose)"
  "${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" down
else
  echo "[!] Docker Compose not found; cannot stop backend automatically."
fi

echo "[+] Stopped"
