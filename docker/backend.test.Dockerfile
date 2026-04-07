# syntax=docker/dockerfile:1
FROM python:3.13-slim-bookworm

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/tmp/solaudity-tests.db \
    SECRET_KEY=test-secret-key \
    ALGORITHM=HS256 \
    ACCESS_TOKEN_EXPIRE_MINUTES=30 \
    PYTHONPATH=/app

# Base packages + glibc upgrade on arm64
# bookworm ships glibc 2.36; the arm64 heimdall binary requires GLIBC_2.39 (trixie).
RUN apt-get update \
    && apt-get full-upgrade -y \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && if [ "$(uname -m)" = "aarch64" ]; then \
         echo "deb http://deb.debian.org/debian trixie main" > /etc/apt/sources.list.d/trixie.list \
         && printf 'Package: *\nPin: release a=trixie\nPin-Priority: 100\nPackage: libc6\nPin: release a=trixie\nPin-Priority: 600\n' \
            > /etc/apt/preferences.d/99trixie-libc \
         && apt-get update \
         && apt-get install -y -t trixie libc6 \
         && rm /etc/apt/sources.list.d/trixie.list /etc/apt/preferences.d/99trixie-libc; \
       fi \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Installing heimdall — amd64 from upstream, arm64 from fork (aircag/heimdall-rs)
RUN ARCH=$(uname -m) \
    && if [ "$ARCH" = "aarch64" ]; then \
         curl -L "https://github.com/aircag/heimdall-rs/releases/download/v0.9.2-test/heimdall-linux-arm64" --output /usr/local/bin/heimdall; \
       else \
         curl -L "https://github.com/Jon-Becker/heimdall-rs/releases/download/0.9.2/heimdall-linux-amd64" --output /usr/local/bin/heimdall; \
       fi \
    && chmod +x /usr/local/bin/heimdall

COPY requirements.txt requirements-dev.txt ./
RUN pip install --upgrade pip wheel "jaraco.context>=6.1.1" \
    && pip install -r requirements.txt -r requirements-dev.txt

COPY app ./app
COPY pytest.ini ./pytest.ini
COPY tests ./tests

CMD ["python", "-m", "pytest", "tests", "-vv", "-rA", "--color=yes"]
