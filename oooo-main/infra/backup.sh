#!/usr/bin/env bash
set -euo pipefail

DB_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/coinhunter}
OUT=${1:-backup-$(date +%F).sql}

echo "Backing up to $OUT"
pg_dump "$DB_URL" -Fc -f "$OUT"

echo "Backup complete"
