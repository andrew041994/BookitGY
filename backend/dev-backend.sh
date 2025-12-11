#!/usr/bin/env bash
export DATABASE_URL="postgresql+psycopg2://postgres:postgres@localhost:8003/postgres"
export CLOUDINARY_URL="cloudinary://<API_KEY>:<API_SECRET>@<CLOUD_NAME>"

set -e
set -a
source .env
set +a



cd "$(dirname "$0")"

# Start Postgres container
echo "Starting dev DB container (bookitgy-dev-db)..."
sudo docker start bookitgy-dev-db || echo "DB container already running or not found."

# Activate venv
if [ -d ".venv" ]; then
  source .venv/bin/activate
fi

# Show DATABASE_URL
echo "DATABASE_URL is: $DATABASE_URL"

# Start uvicorn
echo "Starting FastAPI on http://0.0.0.0:8000 ..."
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
