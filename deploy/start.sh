#!/bin/bash
# Start im Container: Datenbank anlegen, Tabellen und Testschule laden, Server starten.
set -euo pipefail
export PATH="/usr/lib/postgresql/16/bin:$PATH"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA" && chown postgres:postgres "$PGDATA"
  gosu postgres initdb --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
fi
# Klein halten (Gratis-Stufe: 512 MB Speicher), nur im Container erreichbar
gosu postgres pg_ctl -w -s -D "$PGDATA" -o "-c listen_addresses=127.0.0.1 -c shared_buffers=32MB -c max_connections=40" start

psql_su() { gosu postgres psql -v ON_ERROR_STOP=1 -qtA "$@"; }
if [ "$(psql_su -c "SELECT 1 FROM pg_roles WHERE rolname='schule_owner'")" != "1" ]; then
  psql_su -c "CREATE ROLE schule_owner LOGIN PASSWORD 'container-owner' BYPASSRLS"
  psql_su -c "CREATE ROLE schule_app LOGIN PASSWORD 'container-app' NOBYPASSRLS"
  psql_su -c "CREATE DATABASE schule OWNER schule_owner"
fi

export DATABASE_OWNER_URL="postgres://schule_owner:container-owner@127.0.0.1/schule"
export DATABASE_URL="postgres://schule_app:container-app@127.0.0.1/schule"
node packages/db/migrate.mjs
node packages/db/seed.mjs

echo "RESCOOL (Test) startet auf Port ${PORT:=10000}"
exec node apps/api/src/server.mjs
