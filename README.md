# Solaudity

Solaudity is a platform built to simplify how you manage smart contract audits. Instead of juggling multiple tools, terminals, and documents, everything you need during an audit is accessible directly from the interface: run analysis tools, browse contract code, track findings, and generate reports without leaving the app.

The idea behind Solaudity is to structure an audit into five clear phases, so nothing gets skipped and the process stays organized from start to finish.

### Scope Definition

This is where the audit begins. You define what is in scope: import contracts from GitHub, block explorers (Etherscan, Arbiscan, and others), or upload files manually. You also register the on-chain addresses related to the project and mark what is out of scope with a reason. By the end of this phase you have a clean picture of what you are auditing.

### Enumeration

Once the scope is defined, you start understanding the codebase. This phase gives you a structural view of the contracts: functions, state variables, events, inheritance, and call graphs. The goal is to know the code before you start looking for vulnerabilities.

### Static Analysis

Here you run automated tools against the contracts directly from the interface. Static analysis catches a wide range of common vulnerabilities quickly and gives you a first layer of findings to review. You can validate results, dismiss false positives, and keep only what matters.

### Dynamic Analysis

This phase goes deeper. You run tools that simulate execution, fuzz the contracts, or formally verify properties. It is slower but catches issues that static analysis misses, especially logic bugs and edge cases under specific conditions.

### Reporting

At the end of the audit you generate the report from everything collected during the previous phases. Findings, context, and conclusions are assembled into a structured document ready to deliver.

---

## Installation

**Requirements:** Docker and Docker Compose. That is it.

```bash
git clone https://github.com/Solaudity-Corp/solaudity.git
cd solaudity
./start.sh dev    # development mode with live reload
./start.sh prod   # production mode
```

Once running:
- Frontend: http://localhost:5173
- Backend: http://localhost:8001

The first build takes a while because it downloads all the analysis tools. After that, starting the app is fast.

**API keys**

Two optional keys unlock additional features. You set them in your user profile after logging in, no need to configure anything before starting.

- **Etherscan API key**: required to import contracts directly from block explorers (Etherscan, Arbiscan, Polygonscan, etc.)
- **AI provider key**: required to use the AI metadata extraction feature, which reads free-text audit briefs and fills in audit fields automatically. Supported providers: OpenAI, Groq, XAI, Gemini.

**Important notice**

Do not expose Solaudity to the public internet. Even though the app has an authentication system, it is designed for internal use only. By default it gives authenticated users access to bash-level functionality through the analysis tools, which is intentional for an audit workstation but dangerous on a publicly reachable server.

---

## Testing

```bash
./test.sh              # interactive menu
./test.sh unit         # backend and frontend unit tests
./test.sh api-security # API surface and authentication tests
./test.sh appsec       # unit tests plus API security tests
./test.sh smoke        # full integration test: builds images, starts the stack, exercises all APIs, then tears everything down
./test.sh full         # runs everything
```

Before running tests, make sure Docker is running and ports 8001 and 5173 are free.

---

## Stop and Cleanup

```bash
./stop.sh      # stop all containers
./delete.sh    # full reset: removes containers, volumes, and images
```
