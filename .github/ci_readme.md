# CI/CD Workflows

Two GitHub Actions workflows run on every pull request to `main`.

## Workflows

| Workflow | File | Jobs | Purpose |
|----------|------|------|---------|
| **CI** | `ci.yml` | frontend, backend, semgrep | Fast feedback: lint, build, security scans |
| **Integration** | `integration.yml` | integration | Docker build (cached), health checks, Trivy |

Both run in parallel on PRs. Branch protection should require both to pass before merge.

## CI (`ci.yml`)

### Frontend

Runs in `frontend/` with Node 24:

1. `npm ci` - install locked dependencies
2. `npm run lint` - ESLint
3. `npm run build` - PandaCSS generation + TypeScript + Vite production build
4. `npm audit --audit-level=moderate` - flag known vulnerabilities

### Backend

Runs in `backend/` with Python 3.11:

1. `pip install -r requirements.txt` - install app dependencies
2. `pip install "safety<3" bandit` - install CI-only tools
3. `safety check --file requirements.txt` - check for known CVEs
4. `bandit -r app/` - static security analysis of Python code

### Semgrep SAST

Free static analysis replacing CodeQL (which requires GitHub Advanced Security, a paid feature):

1. Runs `returntocorp/semgrep-action@v1` on the full codebase
2. Uses community rulesets: `p/default`, `p/javascript`, `p/typescript`, `p/python`, `p/security-audit`, `p/owasp-top-ten`
3. Covers OWASP Top 10, injection flaws, XSS, insecure patterns, and more

No account or token required — fully open-source.

## Integration (`integration.yml`)

Uses **Docker layer caching** (`type=gha`) via `docker/build-push-action` to avoid full rebuilds. Only layers affected by changes are rebuilt.

1. Build backend image (cached via GHA cache)
2. Build frontend image (cached via GHA cache)
3. `docker compose up --no-build` - start services using pre-built images
4. Health-check backend (`localhost:8001/health`) and frontend (`localhost:5173/`)
5. Trivy scans on both Docker images (CRITICAL + HIGH severity)
6. Compose down + cleanup (runs even if earlier steps fail)

> **Note:** SARIF upload to GitHub's Security tab is commented out — it requires GitHub Advanced Security (paid). Trivy results are still reported in PR comments and job summaries.

### How the cache works

- First run: full Docker build, all layers stored in GitHub Actions cache (10 GB/repo)
- Subsequent runs: only layers that changed are rebuilt (e.g. code copy layer)
- Cache is scoped per image (`scope=frontend`, `scope=backend`)
- `mode=max` caches all layers, not just the final image layers

## Debugging Failures

### npm audit

```bash
cd frontend
npm audit                    # see full report
npm audit fix                # auto-fix where possible
```

### safety / bandit

```bash
cd backend
pip install "safety<3" bandit
safety check --file requirements.txt
bandit -r app/
```

### Trivy

Container image vulnerabilities usually require updating base images or system packages in the Dockerfiles.

### Semgrep

```bash
# Install semgrep locally
pip install semgrep

# Run with the same rulesets as CI
semgrep --config p/default --config p/javascript --config p/typescript --config p/python --config p/security-audit --config p/owasp-top-ten .
```

## Running Checks Locally

```bash
# Frontend
cd frontend && npm ci && npm run lint && npm run build && npm audit --audit-level=moderate

# Backend
cd backend && pip install -r requirements.txt && pip install "safety<3" bandit && safety check --file requirements.txt && bandit -r app/

# Semgrep
pip install semgrep && semgrep --config p/default --config p/owasp-top-ten .

# Integration (requires Docker)
./start.sh prod
curl -sf http://localhost:8001/health
curl -sf http://localhost:5173/
./delete.sh
```

## Job Summaries

Every job writes a rich markdown summary to `$GITHUB_STEP_SUMMARY`, visible on the workflow run page. Summaries are also posted as PR comments (guarded against empty content).

| Job | Summary contents |
|-----|-----------------|
| **Frontend** | Pass/fail table (install, lint, build, audit) + npm vulnerability counts by severity |
| **Backend** | Pass/fail table (install, safety, bandit) + safety vuln count + bandit severity breakdown |
| **Semgrep** | Pass/fail status for SAST scan |
| **Integration** | Docker build status + health check status + Trivy vuln counts per image (Critical/High) |

**How it works:**

- Steps use `continue-on-error: true` so summaries are always generated, even on failure
- A final "Check results" step enforces the actual pass/fail outcome
- Vulnerability details are available in collapsible `<details>` blocks
- JSON outputs (`npm audit --json`, `bandit -f json`, `trivy --format json`) are parsed with `jq` for counts
- PR comment steps check for non-empty summary before posting to avoid `Body cannot be blank` errors

## Notes

- No CD workflow exists yet (no deployment target)
- CodeQL job is commented out in `ci.yml` — can be re-enabled if GitHub Advanced Security is purchased
- SARIF upload steps are commented out in `integration.yml` for the same reason
- Issue templates live in `ISSUE_TEMPLATE/` and are unrelated to CI
