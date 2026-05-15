#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f data/employer.db ]; then
  echo "Seeding database..."
  node database/seed.js
fi

echo "Starting ERO System on http://localhost:3000"
node server.js
