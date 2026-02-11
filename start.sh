#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

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

echo "[+] Starting backend + frontend (Docker Compose)"
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" up -d --build

echo "[+] Started"
echo "[i] Backend:  http://localhost:8001"
echo "[i] Frontend: http://localhost:5173"
