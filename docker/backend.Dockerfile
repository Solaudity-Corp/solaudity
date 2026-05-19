# syntax=docker/dockerfile:1

# ── Stage: Python 3.11 source ─────────────────────────────────────────────────
# mythril 0.24.8 is incompatible with Python 3.13.
# Trixie has no python3.11 apt package, so we copy the interpreter + stdlib from
# the official 3.11 Bookworm image.  glibc on Trixie (2.41) is newer than
# Bookworm (2.36) — backwards-compatible, so the binary runs fine.
FROM python:3.11-slim-bookworm AS python311

# ── Main stage ────────────────────────────────────────────────────────────────
FROM python:3.13-slim-trixie

WORKDIR /app

# Copy Python 3.11 interpreter + stdlib + headers + shared library from the build stage.
# The include dir is required to compile C extensions (e.g. pyethash) inside the mythril venv.
COPY --from=python311 /usr/local/bin/python3.11 /usr/local/bin/python3.11
COPY --from=python311 /usr/local/lib/python3.11 /usr/local/lib/python3.11
COPY --from=python311 /usr/local/include/python3.11 /usr/local/include/python3.11
COPY --from=python311 /usr/local/lib/libpython3.11.so.1.0 /usr/local/lib/libpython3.11.so.1.0
RUN ln -sf /usr/local/lib/libpython3.11.so.1.0 /usr/local/lib/libpython3.11.so \
    && ldconfig

# Install Node.js for Solidity analysis tooling.
# Also enable amd64 multi-arch so solc-select's x86_64 binaries run via QEMU on ARM64 hosts.
RUN dpkg --add-architecture amd64 \
    && apt-get update \
    && apt-get full-upgrade -y \
    && apt-get install -y --no-install-recommends curl ca-certificates libc6:amd64 \
       libgmp-dev libssl-dev libffi-dev build-essential pkg-config cmake \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install surya CLI with patched transitive dependencies (overrides in package.json)
COPY surya/ /opt/surya/
RUN cd /opt/surya \
    && npm ci --omit=dev \
    && npm cache clean --force
ENV PATH="/opt/surya/node_modules/.bin:${PATH}"

# Pre-install all major OpenZeppelin versions so surya can resolve any import.
# Each version is installed in a temp dir, then merged with cp -n (no-clobber)
# so v5 files take precedence, v4 fills deprecated files, v3/v2 fill the rest.
# NOTE: must be outside /data — that path is a host volume mount at runtime.
RUN mkdir -p /usr/local/sol-libs/node_modules \
    && npm install --prefix /tmp/oz2 @openzeppelin/contracts@2 @openzeppelin/contracts-upgradeable@2 || true \
    && npm install --prefix /tmp/oz3 @openzeppelin/contracts@3 @openzeppelin/contracts-upgradeable@3 \
    && npm install --prefix /tmp/oz4 @openzeppelin/contracts@4 @openzeppelin/contracts-upgradeable@4 \
    && npm install --prefix /tmp/oz5 @openzeppelin/contracts@5 @openzeppelin/contracts-upgradeable@5 \
    && cp -rn /tmp/oz5/node_modules/@openzeppelin /usr/local/sol-libs/node_modules/ \
    && cp -rn /tmp/oz4/node_modules/@openzeppelin /usr/local/sol-libs/node_modules/ \
    && cp -rn /tmp/oz3/node_modules/@openzeppelin /usr/local/sol-libs/node_modules/ \
    && (cp -rn /tmp/oz2/node_modules/@openzeppelin /usr/local/sol-libs/node_modules/ 2>/dev/null || true) \
    && rm -rf /tmp/oz2 /tmp/oz3 /tmp/oz4 /tmp/oz5 \
    && chmod -R 777 /usr/local/sol-libs \
    && mkdir -p /usr/local/sol-libs/node_modules/ds-test \
    && curl -sL https://github.com/dapphub/ds-test/archive/refs/heads/master.tar.gz \
       | tar xz -C /tmp/ \
    && cp -r /tmp/ds-test-master/src/. /usr/local/sol-libs/node_modules/ds-test/ \
    && rm -rf /tmp/ds-test-master \
    && curl -sL https://github.com/Vectorized/solady/archive/refs/heads/main.tar.gz \
       | tar xz -C /tmp/ \
    && cp -r /tmp/solady-main/. /usr/local/sol-libs/node_modules/@solady/ \
    && cp -r /tmp/solady-main/. /usr/local/sol-libs/node_modules/solady/ \
    && rm -rf /tmp/solady-main


# Installing heimdall — amd64 from upstream, arm64 from fork (aircag/heimdall-rs)
RUN ARCH=$(uname -m) \
    && if [ "$ARCH" = "aarch64" ]; then \
         curl -L "https://github.com/aircag/heimdall-rs/releases/download/v0.9.2-test/heimdall-linux-arm64" --output /usr/local/bin/heimdall; \
       else \
         curl -L "https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.2/heimdall-linux-amd64" --output /usr/local/bin/heimdall; \
       fi \
    && chmod +x /usr/local/bin/heimdall

COPY requirements.txt .
RUN pip install --upgrade pip setuptools wheel "jaraco.context>=6.1.1" \
    && pip install -r requirements.txt

# Slither and Mythril require conflicting eth-abi versions, so each gets its
# own venv. The CLI binaries are symlinked into PATH so subprocess calls work.
RUN python3 -m venv /opt/venv-slither \
    && /opt/venv-slither/bin/pip install --upgrade pip \
    && /opt/venv-slither/bin/pip install slither-analyzer==0.11.5 \
    && ln -sf /opt/venv-slither/bin/slither /usr/local/bin/slither \
    && ln -sf /opt/venv-slither/bin/crytic-compile /usr/local/bin/crytic-compile \
    && ln -sf /opt/venv-slither/bin/solc-select /usr/local/bin/solc-select \
    && ln -sf /opt/venv-slither/bin/solc /usr/local/bin/solc

# Pre-create the mythril venv directory (world-writable) so the runtime installer
# can populate it regardless of which user the container runs as.
# /opt/venv-mythril/bin is added to PATH below so 'myth' is found once installed —
# no symlink into /usr/local/bin is needed (which would require root at runtime).
RUN mkdir -p /opt/venv-mythril && chmod 777 /opt/venv-mythril


# solc-select stores compiler binaries in SOLC_SELECT_ARTIFACTS_FOLDER.
# Without this it defaults to ~/.solc-select which resolves to /.solc-select
# inside containers that run without a real home dir — causing PermissionError.
# Use a world-accessible home so solc-select works for any runtime user.
# /root has 700 perms — non-root users can't traverse it regardless of subdir perms.
RUN mkdir -p /opt/solc-home && chmod 777 /opt/solc-home
ENV HOME=/opt/solc-home
# myth lives in the runtime-installed venv; add its bin to PATH so no root-owned symlink is needed.
ENV PATH="/opt/venv-mythril/bin:${PATH}"

# Pre-install common solc versions so Slither can compile without network access at runtime.
# solc-select lives inside the slither venv (not on system PATH) since we moved slither out of requirements.txt.
RUN /opt/venv-slither/bin/solc-select install 0.8.30 0.8.28 0.8.20 0.8.17 0.8.0 0.7.6 0.6.12 \
    && /opt/venv-slither/bin/solc-select use 0.8.28 \
    && chmod -R 777 /opt/solc-home/.solc-select

# 4naly3er — TypeScript static analyser (Node.js is already present from the surya step)
RUN curl -sL https://github.com/Picodes/4naly3er/archive/refs/heads/main.tar.gz \
       | tar xz -C /tmp/ \
    && mv /tmp/4naly3er-main /opt/4naly3er \
    && cd /opt/4naly3er \
    && npm install --legacy-peer-deps \
    && npm cache clean --force
COPY 4naly3er-run-json.ts /opt/4naly3er/run_json.ts

# z3 SMT solver — required by solc's CHC engine (SMTChecker)
RUN apt-get update \
    && apt-get install -y --no-install-recommends z3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Certora Prover (local JVM mode) ──────────────────────────────────────────
# Installs OpenJDK (required to run the CertoraProver JAR) and certora-cli in
# its own venv so it cannot conflict with the main requirements.
# certora-cli bundles the CertoraProver JAR and runs it locally via --local.
RUN apt-get update \
    && apt-get install -y --no-install-recommends default-jre-headless \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv-certora \
    && /opt/venv-certora/bin/pip install --upgrade pip \
    && /opt/venv-certora/bin/pip install certora-cli \
    && ln -sf /opt/venv-certora/bin/certoraRun /usr/local/bin/certoraRun

# Pre-download the CertoraProver JAR at build time so the image starts offline-ready.
# HOME is already /opt/solc-home — certora-cli caches the JAR there, keeping it in
# this image layer. The warmup proof is expected to fail (empty contract / trivial spec);
# only the JAR fetch matters. We clean up the temp files afterwards.
RUN mkdir -p /tmp/certora-warmup \
    && printf 'pragma solidity ^0.8.0;\ncontract Warmup {}\n' \
         > /tmp/certora-warmup/Warmup.sol \
    && printf 'methods {}\nrule trivial() { assert true; }\n' \
         > /tmp/certora-warmup/Warmup.spec \
    && (cd /tmp/certora-warmup \
        && certoraRun Warmup.sol \
             --verify Warmup:Warmup.spec \
             --solc /usr/local/bin/solc \
             --local \
             --output_folder /tmp/certora-out \
             2>&1 | head -200) \
    || echo "Certora warmup exited non-zero — expected, JAR should now be cached" \
    && rm -rf /tmp/certora-warmup /tmp/certora-out \
    && (chmod -R 777 /opt/solc-home/.certora 2>/dev/null || true)

COPY app ./app
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
