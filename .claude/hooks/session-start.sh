#!/bin/bash
# SessionStart-Hook für Claude-Code-Cloud-Sitzungen: Abhängigkeiten, lokale PostgreSQL-Instanz,
# Entwicklungs- und Testdatenbank, Prisma-Client und Migrationen. Idempotent und nicht interaktiv.
# Lokal (außerhalb der Cloud) tut der Hook nichts.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
log() { echo "[session-start] $*" >&2; }

# 1) Node-Abhängigkeiten (npm install nutzt den Container-Cache besser als npm ci)
npm install --no-audit --no-fund >&2

# 2) PostgreSQL 16 bereitstellen und starten
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  log "PostgreSQL fehlt – Installation per apt"
  if ! (apt-get update -qq >&2 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql >&2); then
    log "WARNUNG: PostgreSQL konnte nicht installiert werden – DB-Tests und App-Start sind nicht möglich"
    exit 0
  fi
fi
PG_VER="$(ls /etc/postgresql 2>/dev/null | sort -V | tail -1)"
if [ -z "$PG_VER" ]; then log "WARNUNG: kein PostgreSQL-Cluster gefunden"; exit 0; fi
if ! pg_ctlcluster "$PG_VER" main status >/dev/null 2>&1; then
  # Nach Container-Neustarts bleibt eine veraltete PID-Datei liegen; pg_ctlcluster räumt sie selbst auf
  pg_ctlcluster "$PG_VER" main start >&2
fi
for _ in $(seq 1 30); do pg_isready -q -h localhost -p 5432 && break; sleep 1; done

# 3) .env anlegen, falls nicht vorhanden – mit zufälligem, nur lokal gültigem Passwort (nie im Repository)
if [ ! -f .env ]; then
  PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  cat > .env <<ENV
DATABASE_URL="postgresql://handelsbuch:${PW}@localhost:5432/handelsbuch?schema=public"
ENV
  log ".env mit lokalem Zufallspasswort erzeugt"
fi
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
DB_PW="$(printf '%s' "$DB_URL" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
TEST_URL="$(printf '%s' "$DB_URL" | sed -E 's#/handelsbuch\?#/handelsbuch_test?#')"

# 4) Rolle und Datenbanken (Passwort der Rolle an .env angleichen)
psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtA $*"; }
if [ "$(psql_admin "-c \"SELECT 1 FROM pg_roles WHERE rolname='handelsbuch'\"")" != "1" ]; then
  psql_admin "-c \"CREATE ROLE handelsbuch LOGIN CREATEDB\"" >&2
fi
psql_admin "-c \"ALTER ROLE handelsbuch PASSWORD '${DB_PW//\'/\'\'}'\"" >/dev/null
for DB in handelsbuch handelsbuch_test; do
  if [ "$(psql_admin "-c \"SELECT 1 FROM pg_database WHERE datname='${DB}'\"")" != "1" ]; then
    psql_admin "-c \"CREATE DATABASE ${DB} OWNER handelsbuch\"" >&2
  fi
done

# 5) Prisma-Client und Migrationen (nicht destruktiv)
npx prisma generate >&2
DATABASE_URL="$DB_URL" npx prisma migrate deploy >&2
DATABASE_URL="$TEST_URL" npx prisma migrate deploy >&2

# 6) Testdatenbank für Integrations- und E2E-Tests in der Sitzung bekanntmachen (nur *_test, wird von Tests geleert)
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export TEST_DATABASE_URL=\"${TEST_URL}\""
    echo "export E2E_DATABASE_URL=\"${TEST_URL}\""
  } >> "$CLAUDE_ENV_FILE"
fi
log "fertig: PostgreSQL ${PG_VER} läuft, Datenbanken migriert"
