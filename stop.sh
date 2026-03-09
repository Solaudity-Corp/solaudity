#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

export HOST_UID="$(id -u)"
export HOST_GID="$(id -g)"
# Detect docker compose command
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "[-] Docker Compose not found. Install Docker Desktop / docker-compose."
  exit 1
fi

echo "[+] Stopping solaudity (Docker Compose)"
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile "*" stop
echo "[+] Stopped"
