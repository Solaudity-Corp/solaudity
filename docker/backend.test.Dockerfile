# syntax=docker/dockerfile:1
FROM python:3.14-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/tmp/solaudity-tests.db \
    SECRET_KEY=test-secret-key \
    ALGORITHM=HS256 \
    ACCESS_TOKEN_EXPIRE_MINUTES=30 \
    PYTHONPATH=/app

# Enable amd64 multi-arch so solc-select's x86_64 binaries run via QEMU on ARM64 hosts.
# Installing heimdall from upstream Jon-Becker/heimdall-rs v0.9.3 (linux amd64/arm64)
# bookworm ships glibc 2.36; the upstream heimdall binary requires GLIBC_2.39 (trixie).
RUN dpkg --add-architecture amd64 \
    && echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list \
    && printf 'Package: *\nPin: release a=trixie\nPin-Priority: 100\n\nPackage: libc6 libc6:amd64 libc-bin libc6-dev libc6-dev:amd64 libc-dev-bin libgcc-s1 libgcc-s1:amd64\nPin: release a=trixie\nPin-Priority: 600\n' \
       > /etc/apt/preferences.d/99trixie-libc \
    && apt-get update \
    && apt-get install -y -t trixie libc6 libc6:amd64 libc-bin libc6-dev libc6-dev:amd64 libc-dev-bin libgcc-s1 libgcc-s1:amd64 \
    && rm /etc/apt/sources.list.d/trixie.list /etc/apt/preferences.d/99trixie-libc \
    && apt-get full-upgrade -y \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "aarch64" ]; then \
         curl -L "https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.3/heimdall-linux-arm64" --output /usr/local/bin/heimdall; \
       else \
         curl -L "https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.3/heimdall-linux-amd64" --output /usr/local/bin/heimdall; \
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
