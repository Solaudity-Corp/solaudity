#!/bin/sh
set -e

# Default runtime env values; callers can still override them.
: "${DB_PATH:=/data/solaudity.db}"
: "${ALGORITHM:=HS256}"
: "${ACCESS_TOKEN_EXPIRE_MINUTES:=30}"

if [ -z "${SECRET_KEY:-}" ]; then
  SECRET_KEY="$(python -c 'import secrets,string; alphabet=string.ascii_letters+string.digits; print("".join(secrets.choice(alphabet) for _ in range(50)))')"
  echo "⚠️ SECRET_KEY not provided; generated ephemeral 50-char key for this startup."
fi

export DB_PATH
export SECRET_KEY
export ALGORITHM
export ACCESS_TOKEN_EXPIRE_MINUTES

mkdir -p "$(dirname "$DB_PATH")"

echo "🔄 Running Alembic migrations..."
cd /app/app
alembic upgrade head

echo "✅ Migrations complete!"
echo "🚀 Starting Uvicorn..."
cd /app
exec uvicorn app.main:app --host 0.0.0.0 --port 8001
