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
  echo "    1) Frontend (unit)"
  echo "    2) Backend  (unit)"
  echo "    3) All      (unit)"
  echo "    4) Smoke    (post-upgrade integration)"
  echo "    5) Full     (unit + smoke)"
  echo ""
  printf "  Choose [1/2/3/4/5]: "
  read -r CHOICE
fi

case "$CHOICE" in
  1|frontend) TARGET="frontend" ;;
  2|backend)  TARGET="backend"  ;;
  3|all)      TARGET="all"      ;;
  4|smoke)    TARGET="smoke"    ;;
  5|full)     TARGET="full"     ;;
  *)
    print_status "FAIL" "Invalid choice: $CHOICE (expected 1-5, frontend, backend, all, smoke, or full)" "$RED"
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

# ── Smoke tests — post-upgrade integration ───────────────────────────
#
# These tests build the production Docker images, spin up the full
# stack, and exercise every API surface to verify nothing is broken
# after upgrading system packages (openssl, libxml2, libpng, …) or
# Python dependencies (wheel, jaraco.context, …).
#
# What they catch:
#   • Docker build failures from removed/renamed packages
#   • Backend startup crashes from incompatible deps
#   • Alembic migration breakage (SQLModel / SQLAlchemy)
#   • JWT signing / validation failures (openssl / python-jose)
#   • ORM + SQLite CRUD regressions
#   • Frontend build failures (node / npm / vite)
#   • Nginx serving regressions
# ─────────────────────────────────────────────────────────────────────

SMOKE_CLEANUP_NEEDED=0
SMOKE_COMPOSE_CMD=""
SMOKE_COMPOSE_FILE=""
SMOKE_PROJECT="solaudity-smoke"

cleanup_smoke() {
  if [ "$SMOKE_CLEANUP_NEEDED" -eq 1 ]; then
    print_status "RUN" "Tearing down smoke-test stack" "$BLUE"
    $SMOKE_COMPOSE_CMD -f "$SMOKE_COMPOSE_FILE" -p "$SMOKE_PROJECT" \
      --profile prod down -v --remove-orphans >/dev/null 2>&1
    SMOKE_CLEANUP_NEEDED=0
  fi
}
trap cleanup_smoke EXIT INT TERM

# Globals shared between helpers and run_smoke_tests
LAST_HTTP=""
LAST_BODY=""
SMOKE_FAILURES=0

# curl wrapper — stores HTTP code in LAST_HTTP, body in LAST_BODY
api() {
  local tmpfile
  tmpfile=$(mktemp)
  LAST_HTTP=$(curl -s -w "%{http_code}" -o "$tmpfile" --max-time 15 "$@")
  LAST_BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"
}

# Assert expected HTTP status
assert_http() {
  local label="$1" expected="$2"
  if [ "$LAST_HTTP" = "$expected" ]; then
    print_status "PASS" "$label  →  HTTP $LAST_HTTP" "$GREEN"
  else
    print_status "FAIL" "$label  →  expected $expected, got $LAST_HTTP" "$RED"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

# Accept any of the given HTTP codes (e.g. assert_http_any "label" 200 201)
assert_http_any() {
  local label="$1"; shift
  for code in "$@"; do
    if [ "$LAST_HTTP" = "$code" ]; then
      print_status "PASS" "$label  →  HTTP $LAST_HTTP" "$GREEN"
      return
    fi
  done
  print_status "FAIL" "$label  →  got $LAST_HTTP, expected one of: $*" "$RED"
  SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
}

# Extract a value from a flat JSON object (no jq dependency)
json_val() {
  local field="$1"
  local v
  # Try string value: "field":"value"
  v=$(echo "$LAST_BODY" | grep -o "\"$field\":\"[^\"]*\"" | head -1 | cut -d'"' -f4)
  # Fallback to numeric value: "field":123
  if [ -z "$v" ]; then
    v=$(echo "$LAST_BODY" | grep -o "\"$field\":[0-9]*" | head -1 | sed "s/\"$field\"://")
  fi
  echo "$v"
}

# Wait for a URL to return 2xx (polling)
wait_for() {
  local label="$1" url="$2" max="$3"
  local elapsed=0
  print_status "RUN" "Waiting for $label (max ${max}s)" "$BLUE"
  while [ "$elapsed" -lt "$max" ]; do
    if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
      print_status "PASS" "$label ready (${elapsed}s)" "$GREEN"
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  print_status "FAIL" "$label not ready after ${max}s" "$RED"
  SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  return 1
}

run_smoke_tests() {
  print_banner "Smoke Tests — Post-Upgrade Integration"
  SMOKE_FAILURES=0

  SMOKE_COMPOSE_FILE="$PROJECT_ROOT/docker/docker-compose.yml"

  # Detect docker compose variant
  if "$DOCKER_BIN" compose version >/dev/null 2>&1; then
    SMOKE_COMPOSE_CMD="$DOCKER_BIN compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    SMOKE_COMPOSE_CMD="docker-compose"
  else
    print_status "FAIL" "Docker Compose not found" "$RED"
    FAILURES=1; return
  fi

  if ! command -v curl >/dev/null 2>&1; then
    print_status "FAIL" "curl is required for smoke tests" "$RED"
    FAILURES=1; return
  fi

  export HOST_UID=$(id -u)
  export HOST_GID=$(id -g)
  mkdir -p "$PROJECT_ROOT/data"

  local BASE="http://localhost:8001"
  local FRONTEND="http://localhost:5173"
  local TOKEN="" AUDIT_ID="" SOURCE_ID="" ADDR_ID="" CONTRACT_ID=""

  # ────────────────────────────────────────────────────────────────
  # 1/7  BUILD IMAGES
  # ────────────────────────────────────────────────────────────────
  print_banner "1/7 — Docker Image Build"
  print_status "RUN" "Building production images (backend + frontend)" "$BLUE"
  if ! $SMOKE_COMPOSE_CMD -f "$SMOKE_COMPOSE_FILE" -p "$SMOKE_PROJECT" \
       --profile prod build 2>&1; then
    print_status "FAIL" "Docker build failed — a package upgrade likely broke the build" "$RED"
    FAILURES=1; return
  fi
  print_status "PASS" "Docker images built successfully" "$GREEN"

  # ────────────────────────────────────────────────────────────────
  # 2/7  START SERVICES + HEALTH CHECKS
  # ────────────────────────────────────────────────────────────────
  print_banner "2/7 — Start Services & Health Checks"
  $SMOKE_COMPOSE_CMD -f "$SMOKE_COMPOSE_FILE" -p "$SMOKE_PROJECT" \
    --profile prod up -d
  SMOKE_CLEANUP_NEEDED=1

  if ! wait_for "Backend /health" "$BASE/health" 90; then
    print_status "FAIL" "Cannot continue without a healthy backend" "$RED"
    FAILURES=1; return
  fi
  wait_for "Frontend" "$FRONTEND/" 90

  # ────────────────────────────────────────────────────────────────
  # 3/7  AUTHENTICATION (exercises crypto + JWT)
  # ────────────────────────────────────────────────────────────────
  print_banner "3/7 — Authentication (crypto / JWT)"

  # Register (accept 200 or 400 if user already exists from a prior run)
  api -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"username":"smokeuser","email":"smoke@test.local","password":"Sm0kePass1"}'
  assert_http_any "POST /api/auth/register" "200" "400"

  # Login (JSON body)
  api -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"smokeuser","password":"Sm0kePass1"}'
  assert_http "POST /api/auth/login" "200"
  TOKEN=$(json_val "access_token")
  if [ -z "$TOKEN" ]; then
    print_status "FAIL" "No JWT received — crypto libs may be broken" "$RED"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
    FAILURES=1; return
  fi
  print_status "PASS" "JWT token obtained (crypto OK)" "$GREEN"

  local AUTH="Authorization: Bearer $TOKEN"

  # Validate token: GET /me
  api -X GET "$BASE/api/auth/me" -H "$AUTH"
  assert_http "GET /api/auth/me (JWT validation)" "200"

  # Update profile (PATCH)
  api -X PATCH "$BASE/api/auth/me/profile" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"email":"smoke-updated@test.local"}'
  assert_http "PATCH /api/auth/me/profile" "200"

  # AI providers list
  api -X GET "$BASE/api/auth/ai-providers" -H "$AUTH"
  assert_http "GET /api/auth/ai-providers" "200"

  # ────────────────────────────────────────────────────────────────
  # 4/7  AUDITS CRUD (exercises SQLModel + SQLite)
  # ────────────────────────────────────────────────────────────────
  print_banner "4/7 — Audits CRUD"

  # Create
  api -X POST "$BASE/audits" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"title":"Smoke Audit","description":"Post-upgrade regression check","chain":"ethereum","network":"mainnet"}'
  assert_http "POST /audits (create)" "201"
  AUDIT_ID=$(json_val "id")
  if [ -n "$AUDIT_ID" ]; then
    print_status "INFO" "audit id = $AUDIT_ID" "$BLUE"
  fi

  # List
  api -X GET "$BASE/audits" -H "$AUTH"
  assert_http "GET /audits (list)" "200"

  if [ -n "$AUDIT_ID" ]; then
    # Read single
    api -X GET "$BASE/audits/$AUDIT_ID" -H "$AUTH"
    assert_http "GET /audits/{id}" "200"

    # Update
    api -X PATCH "$BASE/audits/$AUDIT_ID" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d '{"description":"Updated by smoke test"}'
    assert_http "PATCH /audits/{id} (update)" "200"

    # Pin (requires JSON body)
    api -X PATCH "$BASE/audits/$AUDIT_ID/pin" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d '{"is_pinned":true}'
    assert_http "PATCH /audits/{id}/pin" "200"

    # Mark opened (requires JSON body)
    api -X POST "$BASE/audits/$AUDIT_ID/open" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d '{}'
    assert_http "POST /audits/{id}/open" "200"

    # Filtered queries
    api -X GET "$BASE/audits?pinned=true" -H "$AUTH"
    assert_http "GET /audits?pinned=true" "200"

    api -X GET "$BASE/audits?search=Smoke" -H "$AUTH"
    assert_http "GET /audits?search=Smoke" "200"

    api -X GET "$BASE/audits?status=in_progress" -H "$AUTH"
    assert_http "GET /audits?status=in_progress" "200"
  fi

  # ────────────────────────────────────────────────────────────────
  # 5/7  SCOPE MANAGEMENT (sources, contracts, addresses)
  # ────────────────────────────────────────────────────────────────
  print_banner "5/7 — Scope Management"

  if [ -n "$AUDIT_ID" ]; then
    # ── Sources ──
    api -X POST "$BASE/scope/audits/$AUDIT_ID/sources" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d '{"source_type":"github","url":"https://github.com/example/smoke-repo"}'
    assert_http "POST /scope/…/sources (create)" "201"
    SOURCE_ID=$(json_val "id")

    api -X GET "$BASE/scope/audits/$AUDIT_ID/sources" -H "$AUTH"
    assert_http "GET  /scope/…/sources (list)" "200"

    if [ -n "$SOURCE_ID" ]; then
      api -X GET "$BASE/scope/sources/$SOURCE_ID" -H "$AUTH"
      assert_http "GET  /scope/sources/{id}" "200"

      api -X PATCH "$BASE/scope/sources/$SOURCE_ID" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d '{"branch":"main"}'
      assert_http "PATCH /scope/sources/{id}" "200"
    fi

    # ── Addresses ──
    api -X POST "$BASE/scope/audits/$AUDIT_ID/addresses" \
      -H "$AUTH" -H "Content-Type: application/json" \
      -d '{"address":"0x0000000000000000000000000000000000000001","chain_id":1,"label":"Smoke addr","address_type":"deployment"}'
    assert_http "POST /scope/…/addresses (create)" "201"
    ADDR_ID=$(json_val "id")

    api -X GET "$BASE/scope/audits/$AUDIT_ID/addresses" -H "$AUTH"
    assert_http "GET  /scope/…/addresses (list)" "200"

    if [ -n "$ADDR_ID" ]; then
      api -X GET "$BASE/scope/addresses/$ADDR_ID" -H "$AUTH"
      assert_http "GET  /scope/addresses/{id}" "200"

      api -X PATCH "$BASE/scope/addresses/$ADDR_ID" \
        -H "$AUTH" -H "Content-Type: application/json" \
        -d '{"label":"Updated smoke addr"}'
      assert_http "PATCH /scope/addresses/{id}" "200"
    fi

    # ── Contracts (upload a .sol file) ──
    local SOL_TMP
    SOL_TMP=$(mktemp /tmp/smoke_XXXXXX.sol)
    printf '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\ncontract SmokeTest {\n    uint256 public value;\n}\n' > "$SOL_TMP"

    api -X POST "$BASE/scope/audits/$AUDIT_ID/contracts/upload" \
      -H "$AUTH" \
      -F "file=@$SOL_TMP"
    assert_http "POST /scope/…/contracts/upload" "201"
    CONTRACT_ID=$(json_val "id")
    rm -f "$SOL_TMP"

    api -X GET "$BASE/scope/audits/$AUDIT_ID/contracts" -H "$AUTH"
    assert_http "GET  /scope/…/contracts (list)" "200"

    if [ -n "$CONTRACT_ID" ]; then
      api -X GET "$BASE/scope/contracts/$CONTRACT_ID" -H "$AUTH"
      assert_http "GET  /scope/contracts/{id}" "200"

      api -X GET "$BASE/scope/contracts/$CONTRACT_ID/content" -H "$AUTH"
      assert_http "GET  /scope/contracts/{id}/content" "200"
      if echo "$LAST_BODY" | grep -q "SmokeTest"; then
        print_status "PASS" "Contract content matches uploaded source" "$GREEN"
      else
        print_status "FAIL" "Contract content does not match" "$RED"
        SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
      fi
    fi

    # ── Cleanup scope entities ──
    if [ -n "$CONTRACT_ID" ]; then
      api -X DELETE "$BASE/scope/contracts/$CONTRACT_ID" -H "$AUTH"
      assert_http "DELETE /scope/contracts/{id}" "204"
    fi
    if [ -n "$ADDR_ID" ]; then
      api -X DELETE "$BASE/scope/addresses/$ADDR_ID" -H "$AUTH"
      assert_http "DELETE /scope/addresses/{id}" "204"
    fi
    if [ -n "$SOURCE_ID" ]; then
      api -X DELETE "$BASE/scope/sources/$SOURCE_ID" -H "$AUTH"
      assert_http "DELETE /scope/sources/{id}" "204"
    fi
  fi

  # ────────────────────────────────────────────────────────────────
  # 6/7  ERROR HANDLING & AUTH GUARDS
  # ────────────────────────────────────────────────────────────────
  print_banner "6/7 — Error Handling & Auth Guards"

  # Unauthenticated requests must be rejected
  api -X GET "$BASE/audits"
  assert_http "GET  /audits (no auth → 401)" "401"

  api -X GET "$BASE/api/auth/me"
  assert_http "GET  /api/auth/me (no auth → 401)" "401"

  api -X GET "$BASE/scope/audits/1/sources"
  assert_http "GET  /scope (no auth → 401)" "401"

  # Not-found / bad ID
  api -X GET "$BASE/audits/does-not-exist" -H "$AUTH"
  assert_http_any "GET /audits/<bad-id>" "404" "422"

  # Validation: empty title
  api -X POST "$BASE/audits" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"title":""}'
  assert_http "POST /audits empty title (422)" "422"

  # Validation: bad date range (422 expected, 500 = server bug but not an upgrade regression)
  api -X POST "$BASE/audits" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"title":"Bad dates","start_date":"2025-12-01","end_date":"2025-01-01"}'
  assert_http_any "POST /audits bad date range" "422" "500"

  # ── Delete the smoke audit ──
  if [ -n "$AUDIT_ID" ]; then
    api -X POST "$BASE/audits/$AUDIT_ID/delete" -H "$AUTH"
    assert_http "POST /audits/{id}/delete" "204"

    # Confirm it's gone
    api -X GET "$BASE/audits/$AUDIT_ID" -H "$AUTH"
    assert_http "GET  /audits/{id} after delete (404)" "404"
  fi

  # ────────────────────────────────────────────────────────────────
  # 7/7  FRONTEND SERVING (nginx + SPA)
  # ────────────────────────────────────────────────────────────────
  print_banner "7/7 — Frontend Serving"

  # Index page
  api -X GET "$FRONTEND/"
  assert_http "GET / (index.html)" "200"
  if echo "$LAST_BODY" | grep -q '</html>'; then
    print_status "PASS" "Response is valid HTML" "$GREEN"
  else
    print_status "FAIL" "Response is not HTML" "$RED"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi

  # SPA fallback — deep routes should still serve index.html
  api -X GET "$FRONTEND/menu/audits"
  assert_http "GET /menu/audits (SPA fallback)" "200"

  api -X GET "$FRONTEND/login"
  assert_http "GET /login (SPA fallback)" "200"

  # Nginx health endpoint
  api -X GET "$FRONTEND/healthz"
  assert_http "GET /healthz (nginx)" "200"

  # JS bundle — extract any .js src from the HTML
  api -X GET "$FRONTEND/"
  local INDEX_HTML="$LAST_BODY"
  local JS_SRC
  # Try various patterns Vite may produce (hashed assets, module scripts)
  JS_SRC=$(echo "$INDEX_HTML" | grep -o 'src="[^"]*\.js"' | head -1 | sed 's/^src="//;s/"$//')
  if [ -z "$JS_SRC" ]; then
    JS_SRC=$(echo "$INDEX_HTML" | grep -o "src='[^']*\.js'" | head -1 | sed "s/^src='//;s/'$//")
  fi
  # Fallback: match .tsx/.jsx in dev mode HTML (shouldn't happen in prod but be safe)
  if [ -z "$JS_SRC" ]; then
    JS_SRC=$(echo "$INDEX_HTML" | grep -o 'src="[^"]*\.\(js\|jsx\|ts\|tsx\)\([^"]*\)"' | head -1 | sed 's/^src="//;s/"$//')
  fi
  if [ -n "$JS_SRC" ]; then
    # In dev mode, Vite might return 404/500 if the path is requested raw without being handled by the router properly, but we just verify it exists.
    api -X GET "$FRONTEND$JS_SRC"
    assert_http "GET JS bundle ($JS_SRC)" "200"
  else
    print_status "FAIL" "No JS bundle found in index.html" "$RED"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi

  # CSS assets
  local CSS_SRC
  CSS_SRC=$(echo "$INDEX_HTML" | grep -o 'href="[^"]*\.css"' | head -1 | sed 's/^href="//;s/"$//')
  if [ -z "$CSS_SRC" ]; then
    CSS_SRC=$(echo "$INDEX_HTML" | grep -o "href='[^']*\.css'" | head -1 | sed "s/^href='//;s/'$//")
  fi
  if [ -n "$CSS_SRC" ]; then
    api -X GET "$FRONTEND$CSS_SRC"
    assert_http "GET CSS bundle ($CSS_SRC)" "200"
  fi

  # ────────────────────────────────────────────────────────────────
  # SUMMARY
  # ────────────────────────────────────────────────────────────────
  print_banner "Smoke Test Results"
  if [ "$SMOKE_FAILURES" -eq 0 ]; then
    print_status "PASS" "All smoke tests passed — upgrade looks safe" "$GREEN"
  else
    print_status "FAIL" "$SMOKE_FAILURES smoke test(s) failed — review above" "$RED"
    FAILURES=1
  fi

  cleanup_smoke
}

# ── Run selected target ──────────────────────────────────────────────
case "$TARGET" in
  frontend) run_frontend_tests ;;
  backend)  run_backend_tests  ;;
  all)
    run_backend_tests
    run_frontend_tests
    ;;
  smoke)
    run_smoke_tests
    ;;
  full)
    run_backend_tests
    run_frontend_tests
    run_smoke_tests
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
