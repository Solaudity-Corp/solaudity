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

# Export current user UID/GID so the container writes files as the host user
export HOST_UID="$(id -u)"
export HOST_GID="$(id -g)"

# Detect docker compose command (new: `docker compose`, old: `docker-compose`)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE=(docker-compose)
else
  echo "[-] Docker Compose not found. Install Docker Desktop / docker-compose."
  exit 1
fi

wait_for_service() {
  local name="$1" url="$2" timeout="${3:-120}"
  local elapsed=0
  printf "[~] Waiting for %s..." "$name"
  while ! curl -sf "$url" >/dev/null 2>&1; do
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$timeout" ]; then
      echo " timeout!"
      echo "[-] $name did not become ready within ${timeout}s"
      return 1
    fi
    printf "."
  done
  echo " ready!"
}

if [ "$MODE" = "dev" ]; then
  echo "[+] Starting containers (Docker Compose)"
  "${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile dev up -d --remove-orphans solaudity-backend solaudity-frontend-dev

  echo "[~] Installing dependencies & syncing packages (this may take a moment)..."
  wait_for_service "Backend"  "http://localhost:8001/health" 120
  wait_for_service "Frontend" "http://localhost:5173" 180

  echo "[~] Fixing sol-libs permissions..."
  docker exec -u root solaudity-solaudity-backend-1 chmod -R 777 /usr/local/sol-libs 2>/dev/null && echo "[+] sol-libs permissions fixed" || echo "[!] Could not fix sol-libs permissions (non-fatal)"

  echo "[+] Started in dev mode"
  echo "[i] Backend:  http://localhost:8001"
  echo "[i] Frontend: http://localhost:5173 (live reload in Docker)"
  exit 0
fi

echo "[+] Starting solaudity-backend + solaudity-frontend (Docker Compose)"
"${DOCKER_COMPOSE[@]}" -f "$COMPOSE_FILE" --profile prod up -d --build --remove-orphans solaudity-backend solaudity-frontend

echo "[~] Fixing sol-libs permissions..."
wait_for_service "Backend" "http://localhost:8001/health" 120
docker exec -u root solaudity-solaudity-backend-1 chmod -R 777 /usr/local/sol-libs 2>/dev/null && echo "[+] sol-libs permissions fixed" || echo "[!] Could not fix sol-libs permissions (non-fatal)"

echo "[+] Started"
echo "[i] Website: http://localhost:5173"
