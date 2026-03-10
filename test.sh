#!/usr/bin/env bash
set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_BIN="${DOCKER_BIN:-docker}"
BACKEND_TEST_IMAGE="solaudity-backend-tests:local"
FRONTEND_TEST_IMAGE="solaudity-frontend-tests:local"
FAILURES=0

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  BLUE="$(printf '\033[34m')"
  RESET="$(printf '\033[0m')"
else
  BOLD="" RED="" GREEN="" BLUE="" RESET=""
fi

print_banner() {
  printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"
  printf '%s\n' "============================================================"
}

print_status() {
  printf '%s[%s]%s %s\n' "$3" "$1" "$RESET" "$2"
}

# ── Choose what to run ───────────────────────────────────────────────
if [ "$#" -ge 1 ]; then
  CHOICE="$1"
else
  echo ""
  echo "  What do you want to test?"
  echo ""
  echo "    1) Frontend"
  echo "    2) Backend"
  echo "    3) All"
  echo ""
  printf "  Choose [1/2/3]: "
  read -r CHOICE
fi

case "$CHOICE" in
  1|frontend) TARGET="frontend" ;;
  2|backend)  TARGET="backend"  ;;
  3|all)      TARGET="all"      ;;
  *)
    print_status "FAIL" "Invalid choice: $CHOICE (expected 1, 2, 3, frontend, backend, or all)" "$RED"
    exit 1
    ;;
esac

# ── Docker check ─────────────────────────────────────────────────────
require_docker() {
  command -v "$DOCKER_BIN" >/dev/null 2>&1 && "$DOCKER_BIN" info >/dev/null 2>&1
}

if ! require_docker; then
  print_status "FAIL" "Docker is not available. Make sure Docker Desktop is running." "$RED"
  exit 1
fi

# ── Backend tests ────────────────────────────────────────────────────
run_backend_tests() {
  print_banner "Backend Unit Tests (Docker)"

  print_status "RUN" "Building backend test image" "$BLUE"
  if ! "$DOCKER_BIN" build \
    --tag "$BACKEND_TEST_IMAGE" \
    --file "$PROJECT_ROOT/docker/backend.test.Dockerfile" \
    "$PROJECT_ROOT/backend"; then
    print_status "FAIL" "Backend test image build failed." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Running backend tests in Docker" "$BLUE"
  if "$DOCKER_BIN" run --rm "$BACKEND_TEST_IMAGE"; then
    print_status "PASS" "Backend tests passed." "$GREEN"
  else
    print_status "FAIL" "Backend tests failed." "$RED"
    FAILURES=1
  fi

  "$DOCKER_BIN" rmi "$BACKEND_TEST_IMAGE" >/dev/null 2>&1 || true
}

# ── Frontend tests ───────────────────────────────────────────────────
run_frontend_tests() {
  print_banner "Frontend Unit Tests (Docker)"

  print_status "RUN" "Building frontend test image" "$BLUE"
  if ! "$DOCKER_BIN" build \
    --tag "$FRONTEND_TEST_IMAGE" \
    --file "$PROJECT_ROOT/docker/frontend.test.Dockerfile" \
    "$PROJECT_ROOT/frontend"; then
    print_status "FAIL" "Frontend test image build failed." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Running frontend tests in Docker" "$BLUE"
  if "$DOCKER_BIN" run --rm "$FRONTEND_TEST_IMAGE"; then
    print_status "PASS" "Frontend tests passed." "$GREEN"
  else
    print_status "FAIL" "Frontend tests failed." "$RED"
    FAILURES=1
  fi

  "$DOCKER_BIN" rmi "$FRONTEND_TEST_IMAGE" >/dev/null 2>&1 || true
}

# ── Run selected target ──────────────────────────────────────────────
case "$TARGET" in
  frontend) run_frontend_tests ;;
  backend)  run_backend_tests  ;;
  all)
    run_backend_tests
    run_frontend_tests
    ;;
esac

# ── Summary ──────────────────────────────────────────────────────────
print_banner "Test Summary"
if [ "$FAILURES" -eq 0 ]; then
  print_status "PASS" "All requested test suites passed." "$GREEN"
else
  print_status "FAIL" "One or more test suites failed." "$RED"
fi

exit "$FAILURES"
