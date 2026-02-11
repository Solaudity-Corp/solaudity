#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"
MODE="${1:-prod}"

if [ "$MODE" != "prod" ] && [ "$MODE" != "dev" ]; then
  echo "[-] Invalid mode: $MODE"
  echo "[i] Usage: ./start.sh [prod|dev]"
  exit 1
fi

mkdir -p "$PROJECT_ROOT/data"

# Detect docker compose command (new: `docker compose`, old: `docker-compose`)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "[-] Docker Compose not found. Install Docker Desktop / docker-compose."
  exit 1
fi

if [ "$MODE" = "dev" ]; then
  echo "[+] Starting backend + frontend-dev (Docker Compose)"
  "${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile dev up -d --build --remove-orphans backend frontend-dev
  echo "[+] Started in dev mode"
  echo "[i] Backend:  http://localhost:8001"
  echo "[i] Frontend: http://localhost:5173 (live reload in Docker)"
  exit 0
fi

echo "[+] Starting backend + frontend (Docker Compose)"
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile prod up -d --build --remove-orphans backend frontend

echo "[+] Started"
echo "[i] Backend:  http://localhost:8001"
echo "[i] Frontend: http://localhost:5173"
