#!/usr/bin/env bash
set -u

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="all"
MODE="local"
PYTHON_BIN="${PYTHON_BIN:-python3}"
NPM_BIN="${NPM_BIN:-npm}"
FAILURES=0
DOCKER_BIN="${DOCKER_BIN:-docker}"
BACKEND_TEST_IMAGE="${BACKEND_TEST_IMAGE:-solaudity-backend-tests:local}"
FRONTEND_TEST_IMAGE="${FRONTEND_TEST_IMAGE:-solaudity-frontend-tests:local}"

if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  RED="$(printf '\033[31m')"
  GREEN="$(printf '\033[32m')"
  YELLOW="$(printf '\033[33m')"
  BLUE="$(printf '\033[34m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  RED=""
  GREEN=""
  YELLOW=""
  BLUE=""
  RESET=""
fi

print_banner() {
  local title="$1"
  printf '\n%s%s%s\n' "$BOLD" "$title" "$RESET"
  printf '%s\n' "============================================================"
}

print_status() {
  local label="$1"
  local message="$2"
  local color="$3"
  printf '%s[%s]%s %s\n' "$color" "$label" "$RESET" "$message"
}

usage() {
  print_status "FAIL" "Usage: ./test.sh [all|backend|frontend] [local|docker]" "$RED"
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    all|backend|frontend)
      TARGET="$arg"
      ;;
    local|docker)
      MODE="$arg"
      ;;
    *)
      usage
      ;;
  esac
done

require_python_modules() {
  "$PYTHON_BIN" -c "import pytest, fastapi, sqlmodel, httpx" >/dev/null 2>&1
}

require_frontend_packages() {
  (
    cd "$PROJECT_ROOT/frontend" &&
    node -e "for (const name of ['vitest', 'jsdom', '@testing-library/react', '@testing-library/jest-dom']) { require.resolve(name) }"
  ) >/dev/null 2>&1
}

require_docker() {
  command -v "$DOCKER_BIN" >/dev/null 2>&1 && "$DOCKER_BIN" info >/dev/null 2>&1
}

docker_build_image() {
  local image="$1"
  local dockerfile="$2"
  local context_dir="$3"

  "$DOCKER_BIN" build \
    --tag "$image" \
    --file "$dockerfile" \
    "$context_dir"
}

run_backend_tests_local() {
  print_banner "Backend Unit Tests"

  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    print_status "FAIL" "Python executable '$PYTHON_BIN' was not found." "$RED"
    FAILURES=1
    return
  fi

  if ! require_python_modules; then
    print_status "FAIL" "Backend test dependencies are missing. Install them with: pip install -r backend/requirements.txt -r backend/requirements-dev.txt" "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "pytest -vv -rA" "$BLUE"
  if (
    cd "$PROJECT_ROOT/backend" &&
    "$PYTHON_BIN" -m pytest tests -vv -rA --color=yes
  ); then
    print_status "PASS" "Backend unit tests passed." "$GREEN"
  else
    print_status "FAIL" "Backend unit tests failed." "$RED"
    FAILURES=1
  fi
}

run_backend_tests_docker() {
  print_banner "Backend Unit Tests"

  if ! require_docker; then
    print_status "FAIL" "Docker is not installed, not running, or not accessible with '$DOCKER_BIN'." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Building backend test image" "$BLUE"
  if ! docker_build_image \
    "$BACKEND_TEST_IMAGE" \
    "$PROJECT_ROOT/backend/Dockerfile.test" \
    "$PROJECT_ROOT/backend"; then
    print_status "FAIL" "Backend test image build failed." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Running backend tests in Docker" "$BLUE"
  if "$DOCKER_BIN" run --rm "$BACKEND_TEST_IMAGE"; then
    print_status "PASS" "Backend unit tests passed in Docker." "$GREEN"
  else
    print_status "FAIL" "Backend unit tests failed in Docker." "$RED"
    FAILURES=1
  fi
}

run_frontend_tests_local() {
  print_banner "Frontend Unit Tests"

  if ! command -v "$NPM_BIN" >/dev/null 2>&1; then
    print_status "FAIL" "npm executable '$NPM_BIN' was not found." "$RED"
    FAILURES=1
    return
  fi

  if ! require_frontend_packages; then
    print_status "FAIL" "Frontend test dependencies are missing. Install them with: cd frontend && npm install" "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "npm run test:run -- --reporter=verbose" "$BLUE"
  if (
    cd "$PROJECT_ROOT/frontend" &&
    "$NPM_BIN" run test:run -- --reporter=verbose
  ); then
    print_status "PASS" "Frontend unit tests passed." "$GREEN"
  else
    print_status "FAIL" "Frontend unit tests failed." "$RED"
    FAILURES=1
  fi
}

run_frontend_tests_docker() {
  print_banner "Frontend Unit Tests"

  if ! require_docker; then
    print_status "FAIL" "Docker is not installed, not running, or not accessible with '$DOCKER_BIN'." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Building frontend test image" "$BLUE"
  if ! docker_build_image \
    "$FRONTEND_TEST_IMAGE" \
    "$PROJECT_ROOT/frontend/Dockerfile.test" \
    "$PROJECT_ROOT/frontend"; then
    print_status "FAIL" "Frontend test image build failed." "$RED"
    FAILURES=1
    return
  fi

  print_status "RUN" "Running frontend tests in Docker" "$BLUE"
  if "$DOCKER_BIN" run --rm "$FRONTEND_TEST_IMAGE"; then
    print_status "PASS" "Frontend unit tests passed in Docker." "$GREEN"
  else
    print_status "FAIL" "Frontend unit tests failed in Docker." "$RED"
    FAILURES=1
  fi
}

run_backend_tests() {
  if [ "$MODE" = "docker" ]; then
    run_backend_tests_docker
  else
    run_backend_tests_local
  fi
}

run_frontend_tests() {
  if [ "$MODE" = "docker" ]; then
    run_frontend_tests_docker
  else
    run_frontend_tests_local
  fi
}

case "$TARGET" in
  all)
    run_backend_tests
    run_frontend_tests
    ;;
  backend)
    run_backend_tests
    ;;
  frontend)
    run_frontend_tests
    ;;
  *)
    usage
    ;;
esac

print_banner "Test Summary"
if [ "$FAILURES" -eq 0 ]; then
  print_status "PASS" "All requested test suites passed." "$GREEN"
else
  print_status "FAIL" "One or more test suites failed." "$RED"
fi

exit "$FAILURES"
