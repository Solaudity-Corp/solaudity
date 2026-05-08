# syntax=docker/dockerfile:1
FROM python:3.13-slim-trixie

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/tmp/solaudity-tests.db \
    SECRET_KEY=test-secret-key \
    ALGORITHM=HS256 \
    ACCESS_TOKEN_EXPIRE_MINUTES=30 \
    PYTHONPATH=/app

# Enable amd64 multi-arch so solc-select's x86_64 binaries run via QEMU on ARM64 hosts.
# Installing heimdall from aircag/heimdall-rs (linux amd64/arm64)
RUN dpkg --add-architecture amd64 \
    && apt-get update \
    && apt-get full-upgrade -y \
    && apt-get install -y --no-install-recommends curl ca-certificates libc6:amd64 \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "aarch64" ]; then \
         curl -L "https://github.com/aircag/heimdall-rs/releases/download/v0.9.2-test/heimdall-linux-arm64" --output /usr/local/bin/heimdall; \
       else \
         curl -L "https://github.com/aircag/heimdall-rs/releases/download/v0.9.2-test/heimdall-linux-amd64" --output /usr/local/bin/heimdall; \
       fi \
    && chmod +x /usr/local/bin/heimdall

COPY requirements.txt requirements-dev.txt ./
RUN pip install --upgrade pip wheel "jaraco.context>=6.1.1" \
    && pip install -r requirements.txt -r requirements-dev.txt

RUN mkdir -p /opt/solc-home && chmod 777 /opt/solc-home
ENV HOME=/opt/solc-home

RUN pip install solc-select \
    && solc-select install 0.8.28 0.8.20 0.8.17 0.8.0 0.7.6 0.6.12 \
    && solc-select use 0.8.28 \
    && chmod -R 777 /opt/solc-home/.solc-select

COPY app ./app
COPY pytest.ini ./pytest.ini
COPY tests ./tests

CMD ["python", "-m", "pytest", "tests", "-vv", "-rA", "--color=yes", "--override-ini=console_output_style=classic"]
