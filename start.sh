#!/bin/bash
set -e

echo "================================================"
echo "  TradingPlatform — Local Dev Startup"
echo "================================================"

# 1. Start postgres
echo "[1/4] Starting PostgreSQL..."
docker compose up -d postgres
echo "Waiting for postgres to be ready..."
sleep 6

# 2. Run migrations
echo "[2/4] Running database migrations..."
docker compose run --rm backend alembic upgrade head
echo "Migrations applied."

# 3. Start backend
echo "[3/4] Starting FastAPI backend..."
docker compose up -d backend
sleep 3

# 4. Start frontend
echo "[4/4] Starting Next.js frontend..."
docker compose up -d frontend

echo ""
echo "================================================"
echo "  All services running:"
echo "  Backend API:  http://localhost:8000"
echo "  API Docs:     http://localhost:8000/docs"
echo "  Frontend:     http://localhost:3000"
echo "================================================"
echo ""
echo "Tailing logs (Ctrl+C to stop tailing — services keep running):"
docker compose logs -f backend frontend
