# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/tmp/solaudity-tests.db \
    SECRET_KEY=test-secret-key \
    ALGORITHM=HS256 \
    ACCESS_TOKEN_EXPIRE_MINUTES=30 \
    PYTHONPATH=/app

COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements.txt -r requirements-dev.txt

COPY app ./app
COPY pytest.ini ./pytest.ini
COPY tests ./tests

CMD ["python", "-m", "pytest", "tests", "-vv", "-rA", "--color=yes"]
