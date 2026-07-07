# Security Policy

Solaudity is a smart contract auditing framework. As a security tool, we take the
security of the project itself seriously and appreciate responsible disclosure.

## Supported Versions

Only the latest state of the `main` branch is currently supported with security
fixes. This project has not yet cut a stable release; pin to a commit if you need
reproducibility.

| Version        | Supported          |
| -------------- | ------------------ |
| `main` (latest)| :white_check_mark: |
| older commits  | :x:                |

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report vulnerabilities privately through one of the following channels:

1. **GitHub Private Vulnerability Reporting** (preferred) — use the
   **"Report a vulnerability"** button under the repository's **Security** tab.
   This creates a confidential advisory only maintainers can see.
2. **Email** — `solaudity-corp@protonmail.com`

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected component (backend, frontend, a specific analysis tool wrapper, CI, etc.),
- any suggested remediation.

We aim to acknowledge reports within **72 hours** and to provide a remediation
timeline after triage. We will coordinate public disclosure with you and credit
you unless you prefer to remain anonymous.

## Scope

### In scope

- Authentication / authorization bypass in the Solaudity backend API.
- Injection or RCE reachable **without** prior authentication.
- Privilege escalation between users.
- Secret/credential leakage (stored API keys, tokens, JWT handling).
- Supply-chain issues in the build (CI, Docker images, dependencies).
- Vulnerabilities in the CI/CD workflows themselves.

### Out of scope / by design

Solaudity is an **audit workstation**. By design, an *authenticated* user is granted
access to bash-level functionality through the analysis tools. This is intentional
for a local, single-tenant audit environment and is **not** considered a
vulnerability on its own.

For this reason:

- **Do not expose Solaudity to the public internet.** It is designed for internal,
  trusted, single-operator use only.
- Post-authentication command execution via the analysis tooling is expected
  behaviour, not a bug.
- Reports demonstrating command execution *as an already-authenticated user* on a
  correctly-isolated deployment will likely be closed as "by design" — unless they
  show a way to reach that capability **without** valid credentials, or to break out
  of the intended isolation boundary.

If you are unsure whether something is in scope, report it privately and we will
help you figure it out.

## Handling of third-party analysis tools

Solaudity orchestrates external tools (Slither, Mythril, Echidna, Foundry, etc.).
Vulnerabilities in those upstream tools should be reported to their respective
maintainers. If the issue is in **how Solaudity invokes or sandboxes them**, it is
in scope here.
