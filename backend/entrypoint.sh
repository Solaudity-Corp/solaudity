#!/bin/sh
set -e

echo "🔄 Running Alembic migrations..."
cd /app/app
alembic upgrade head

echo "✅ Migrations complete!"
echo "🚀 Starting Uvicorn..."
cd /app
exec uvicorn app.main:app --host 0.0.0.0 --port 8001
