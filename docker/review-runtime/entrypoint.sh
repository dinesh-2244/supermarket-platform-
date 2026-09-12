#!/bin/bash
# Container entrypoint for the review runtime.
#
# Brings up the private PostgreSQL (initialising the cluster on first start),
# then sleeps so the container stays up for `docker exec`. Everything else —
# checkout, migrate, seed, tests — is driven from outside by
# scripts/review-runtime.sh, so this file stays small and boring.
set -euo pipefail

PGDATA=/pg/data
export PGDATA

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "review-runtime: initialising PostgreSQL cluster in $PGDATA"
  su postgres -c "initdb --auth=trust --username=postgres --encoding=UTF8 --locale=C.UTF-8 -D '$PGDATA'" >/dev/null
  # Local connections only. The container publishes no port unless the wrapper
  # was asked to, and even then `trust` auth is fine: the data is a review
  # fixture, never anything real.
  {
    echo "listen_addresses = '*'"
    echo "max_connections = 100"
    echo "shared_buffers = 128MB"
    echo "fsync = off"
    echo "synchronous_commit = off"
    echo "full_page_writes = off"
  } >> "$PGDATA/postgresql.conf"
  echo "host all all 0.0.0.0/0 trust" >> "$PGDATA/pg_hba.conf"
fi

su postgres -c "pg_ctl -D '$PGDATA' -l /pg/postgres.log -w start" >/dev/null
echo "review-runtime: PostgreSQL $(su postgres -c 'psql -Atc "select version()"' | cut -d' ' -f2) ready on localhost:5432"

# Stop the database cleanly when the container is stopped, so a `down` after a
# long probe does not leave the volume mid-checkpoint.
trap 'su postgres -c "pg_ctl -D \"$PGDATA\" -m fast -w stop" >/dev/null; exit 0' TERM INT
sleep infinity &
wait $!
