# Security Policy

Solaudity is a smart contract auditing framework. As a security tool, the
Solaudity team takes security bugs in the project seriously and appreciates
your efforts to responsibly disclose your findings — we will make every
effort to acknowledge your contribution.

## Supported Versions

Only the latest state of the `main` branch is currently supported with
security fixes. This project has not yet cut a stable release; pin to a
commit if you need reproducibility.

| Version         | Supported          |
| --------------- | ------------------- |
| `main` (latest) | :white_check_mark: |
| older commits   | :x:                 |

## Reporting Security Issues

**Do not open a public issue for security vulnerabilities.**

To report a security issue, please use the GitHub Security Advisory
**"Report a Vulnerability"** tab under this repository's **Security** tab.
This creates a confidential advisory that only maintainers can see — it is
the only channel we accept reports through (no email).

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected component (backend, frontend, a specific analysis tool wrapper, CI, etc.),
- any suggested remediation.

The Solaudity team will send a response acknowledging your report and
indicating next steps. After the initial reply, we will keep you informed of
progress towards a fix and coordinate public disclosure with you, crediting
you unless you prefer to remain anonymous.

We aim to acknowledge reports within **72 hours**.

## Escalation

If you do not receive an acknowledgement of your report within **6 business
days**, escalate by @-mentioning the maintainers listed in
[`CODEOWNERS`](./CODEOWNERS) directly on the advisory thread.

If we acknowledge your report but do not provide any further response or
engagement within **14 days**, escalation through the same channel is also
appropriate.

## Scope

### In scope

- Authentication / authorization bypass in the Solaudity backend API.
- Injection or RCE reachable **without** prior authentication.
- Privilege escalation between users.
- Secret/credential leakage (stored API keys, tokens, JWT handling).
- Supply-chain issues in the build (CI, Docker images, dependencies).
- Vulnerabilities in the CI/CD workflows themselves.

### Out of scope / by design

Solaudity is an **audit workstation**. By design, an *authenticated* user is
granted access to bash-level functionality through the analysis tools. This
is intentional for a local, single-tenant audit environment and is **not**
considered a vulnerability on its own.

For this reason:

- **Do not expose Solaudity to the public internet.** It is designed for
  internal, trusted, single-operator use only.
- Post-authentication command execution via the analysis tooling is expected
  behaviour, not a bug.
- Reports demonstrating command execution *as an already-authenticated user*
  on a correctly-isolated deployment will likely be closed as "by design" —
  unless they show a way to reach that capability **without** valid
  credentials, or to break out of the intended isolation boundary.

If you are unsure whether something is in scope, report it privately and we
will help you figure it out.

## Handling of Third-Party Analysis Tools

Solaudity orchestrates external tools (Slither, Mythril, Echidna, Foundry,
etc.). Vulnerabilities in those upstream tools should be reported to their
respective maintainers. If the issue is in **how Solaudity invokes or
sandboxes them**, it is in scope here.

## Learning More About Security

For details on why authenticated command execution is out of scope and how
to run Solaudity safely, see the security notice in the [README](./README.md#configuration).
