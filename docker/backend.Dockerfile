# syntax=docker/dockerfile:1
FROM python:3.13.12-slim

WORKDIR /app

# Install Node.js + surya for Solidity analysis
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g surya \
    && npm install --prefix /usr/lib/node_modules/surya @solidity-parser/parser@latest --cache /tmp/npm-cache-parser

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
    && cp -r /tmp/solady-main/test /usr/local/sol-libs/node_modules/@solady/ \
    && cp -r /tmp/solady-main/test /usr/local/sol-libs/node_modules/solady/ \
    && rm -rf /tmp/solady-main


COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
