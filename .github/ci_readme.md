# CI/CD Workflows

Two GitHub Actions workflows run on every pull request to `main`.

## Workflows

| Workflow | File | Jobs | Purpose |
|----------|------|------|---------|
| **CI** | `ci.yml` | frontend, backend, codeql | Fast feedback: lint, build, security scans |
| **Integration** | `integration.yml` | integration | Docker build (cached), health checks, Trivy |

Both run in parallel on PRs. Branch protection should require both to pass before merge.

## CI (`ci.yml`)

### Frontend

Runs in `frontend/` with Node 22:

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

### CodeQL

Matrix job (JavaScript + Python):

1. Initialize CodeQL with `security-extended` queries
2. Autobuild
3. Analyze and upload results to Security tab

## Integration (`integration.yml`)

Uses **Docker layer caching** (`type=gha`) via `docker/build-push-action` to avoid full rebuilds. Only layers affected by changes are rebuilt.

1. Build backend image (cached via GHA cache)
2. Build frontend image (cached via GHA cache)
3. `docker compose up --no-build` - start services using pre-built images
4. Health-check backend (`localhost:8001/health`) and frontend (`localhost:5173/`)
5. Trivy scans on both Docker images (CRITICAL + HIGH severity)
6. Upload SARIF results to GitHub Security tab
7. Compose down + cleanup (runs even if earlier steps fail)

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

### CodeQL

Review findings in the repository **Security** tab. Address or suppress with justification.

## Running Checks Locally

```bash
# Frontend
cd frontend && npm ci && npm run lint && npm run build && npm audit --audit-level=moderate

# Backend
cd backend && pip install -r requirements.txt && pip install "safety<3" bandit && safety check --file requirements.txt && bandit -r app/

# Integration (requires Docker)
./start.sh prod
curl -sf http://localhost:8001/health
curl -sf http://localhost:5173/
./delete.sh
```

## Notes

- No CD workflow exists yet (no deployment target)
- Issue templates live in `ISSUE_TEMPLATE/` and are unrelated to CI
