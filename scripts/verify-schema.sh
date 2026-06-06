#!/usr/bin/env bash
# Verify database/schema.sql matches the state produced by applying all
# migrations in database/migrations/ in order.
#
# Background: fresh installs run schema.sql; existing installs run
# incremental migrations. database/CLAUDE.md mandates schema.sql must stay
# in sync with migrations. This script proves it.
#
# Usage: scripts/verify-schema.sh
#
# Requires: docker, diff. Uses an ephemeral postgres:16-alpine container.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_IMAGE="postgres:16-alpine"
PG_PASSWORD="verify_schema_pw"
CONTAINER="monize-verify-schema-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f /tmp/monize-schema-dump.sql /tmp/monize-migrations-dump.sql
}
trap cleanup EXIT

echo "Starting postgres ($PG_IMAGE)..."
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" \
  "$PG_IMAGE" >/dev/null

echo "Waiting for postgres to be ready..."
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql_in() {
  docker exec -i -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
    psql -U postgres -v ON_ERROR_STOP=1 "$@"
}

echo "Creating db_schema and db_migrations..."
psql_in -c "CREATE DATABASE db_schema;"
psql_in -c "CREATE DATABASE db_migrations;"

echo "Applying database/schema.sql to db_schema..."
docker cp "$REPO_ROOT/database/schema.sql" "$CONTAINER:/tmp/schema.sql"
psql_in -d db_schema -f /tmp/schema.sql >/dev/null

echo "Applying migrations to db_migrations..."
# db_migrations starts empty; bootstrap the schema_migrations tracking table
# the same way db-migrate does for a brand-new DB.
psql_in -d db_migrations -c "
  CREATE TABLE schema_migrations (
    filename VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
"
for f in "$REPO_ROOT"/database/migrations/*.sql; do
  fname="$(basename "$f")"
  docker cp "$f" "$CONTAINER:/tmp/migration.sql"
  if ! psql_in -d db_migrations -f /tmp/migration.sql >/dev/null 2>&1; then
    echo "FAIL: migration $fname did not apply cleanly to a fresh database"
    psql_in -d db_migrations -f /tmp/migration.sql || true
    exit 1
  fi
done

DUMP_OPTS=(--schema-only --no-comments --no-owner --no-privileges --no-tablespaces)

echo "Dumping schemas..."
docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
  pg_dump "${DUMP_OPTS[@]}" -U postgres db_schema > /tmp/monize-schema-dump.sql
docker exec -e PGPASSWORD="$PG_PASSWORD" "$CONTAINER" \
  pg_dump "${DUMP_OPTS[@]}" -U postgres db_migrations > /tmp/monize-migrations-dump.sql

# Normalize: strip pg_dump headers, SET statements, comments, and blank lines
# so trivial formatting differences don't cause false positives. Real schema
# differences (column types, constraints, indexes, defaults) survive.
normalize() {
  sed -E \
    -e '/^--/d' \
    -e '/^SET /d' \
    -e '/^SELECT pg_catalog/d' \
    -e '/^\\connect/d' \
    -e '/^$/d' \
    "$1"
}

if diff -u <(normalize /tmp/monize-schema-dump.sql) <(normalize /tmp/monize-migrations-dump.sql) > /tmp/monize-schema-diff.txt; then
  echo "OK: schema.sql matches the state produced by all migrations"
  exit 0
fi

echo "FAIL: schema.sql diverges from migrations state"
echo
echo "Diff (schema.sql <-> migrations applied to fresh db):"
echo "-----------------------------------------------------"
cat /tmp/monize-schema-diff.txt
echo "-----------------------------------------------------"
echo
echo "Fix: update database/schema.sql to match the migrations,"
echo "or fix the migrations to produce the schema.sql state."
exit 1
