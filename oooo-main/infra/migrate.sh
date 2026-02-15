#!/usr/bin/env bash
set -euo pipefail

echo "Running migrations..."
DB_URL=${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/coinhunter}

# Apply all SQL migration files in alphabetical order
for f in $(ls infra/migrations/*.sql | sort); do
	echo "Applying $f"
	psql "$DB_URL" -f "$f"
done

echo "Ensuring pgcrypto extension exists"
psql "$DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

echo "Migrations applied."
