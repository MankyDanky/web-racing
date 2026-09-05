#!/usr/bin/env bash
# Render build for the single-service deploy (#7, #8).
# Builds the frontend (same-origin API) and prepares the Django backend.
set -o errexit

echo "── 1/3  Building frontend (same-origin) ─────────────────────────────"
cd frontend
npm ci
# Same-origin: the browser calls the API with relative URLs, so no CORS and no
# separate host is needed — the Django service serves the site and the API.
VITE_API_BASE_URL=same-origin npm run build
cd ..

echo "── 2/3  Installing backend deps ─────────────────────────────────────"
cd backend
pip install -r requirements.txt

echo "── 3/3  Collect static + migrate ────────────────────────────────────"
# FRONTEND_DIST points at the build we just produced.
export FRONTEND_DIST="${FRONTEND_DIST:-$(cd ../frontend/dist && pwd)}"
python manage.py collectstatic --no-input
python manage.py migrate --no-input

echo "✓ Build complete."
