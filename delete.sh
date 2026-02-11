#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

# Detect docker compose command
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "[-] Docker Compose not found. Install Docker Desktop / docker-compose."
  exit 1
fi

echo "[+] Deleting solaudity resources (Containers, Volumes, Images)"
# Target all profiles to ensure we catch dev and prod containers
# -v / --volumes: Remove named volumes declared in the `volumes` section of the Compose file and anonymous volumes attached to containers.
# --rmi all: Remove all images used by any service.
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile "*" down -v --rmi all --remove-orphans

echo "[+] cleanup complete"
