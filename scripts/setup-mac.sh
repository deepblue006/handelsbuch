#!/bin/bash
# Einrichtung des Handelsbuchs auf macOS (Homebrew, Node.js 22, PostgreSQL 16).
# Idempotent: kann gefahrlos mehrfach ausgeführt werden (z. B. nach einem Update per git pull).
# Es werden keine Demodaten angelegt und keine Daten gelöscht.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1) Werkzeuge ──────────────────────────────────────────────────────────────
if [ "${SKIP_BREW:-}" != "1" ]; then
  command -v brew >/dev/null 2>&1 || fail "Homebrew fehlt. Installation: https://brew.sh – den dort angezeigten Befehl im Terminal ausführen, dann dieses Skript erneut starten."
  say "Node.js 22 und PostgreSQL 16 (Homebrew)"
  brew list node@22 >/dev/null 2>&1 || brew install node@22
  brew list postgresql@16 >/dev/null 2>&1 || brew install postgresql@16
  export PATH="$(brew --prefix node@22)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
  brew services start postgresql@16 >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || fail "node nicht gefunden"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js 22 oder neuer nötig (gefunden: $(node -v))"
for _ in $(seq 1 30); do pg_isready -q -h localhost && break; sleep 1; done
pg_isready -q -h localhost || fail "PostgreSQL antwortet nicht – „brew services list“ prüfen"

# ── 2) .env (lokales Zufallspasswort für die Datenbank; API-Schlüssel trägst du später ein) ──
say "Konfiguration (.env)"
if [ ! -f .env ]; then
  PW="$(openssl rand -hex 16)"  # 32 Hex-Zeichen, ohne Pipe (pipefail-sicher)
  sed -e "s#postgresql://handelsbuch:PASSWORT@#postgresql://handelsbuch:${PW}@#g" .env.example > .env
  chmod 600 .env
  echo ".env angelegt (Datenbank-Passwort zufällig, gilt nur lokal). API-Schlüssel später dort eintragen."
else
  echo ".env vorhanden – bleibt unverändert."
fi
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"
DB_PW="$(printf '%s' "$DB_URL" | sed -E 's#^postgres(ql)?://[^:]+:([^@]+)@.*#\2#')"
TEST_URL="$(printf '%s' "$DB_URL" | sed -E 's#/handelsbuch\?#/handelsbuch_test?#')"

# ── 3) Datenbank-Rolle und Datenbanken (Passwort über stdin, nicht in der Prozessliste) ──
say "Datenbank"
PSQL_ADMIN=(${PSQL_ADMIN:-psql -d postgres})
q() { "${PSQL_ADMIN[@]}" -v ON_ERROR_STOP=1 -qtA "$@"; }
[ "$(echo "SELECT 1 FROM pg_roles WHERE rolname='handelsbuch';" | q)" = "1" ] || echo "CREATE ROLE handelsbuch LOGIN CREATEDB;" | q
printf "ALTER ROLE handelsbuch PASSWORD :'pw';\n" | q -v pw="$DB_PW"
for DB in handelsbuch handelsbuch_test; do
  [ "$(echo "SELECT 1 FROM pg_database WHERE datname='${DB}';" | q)" = "1" ] || echo "CREATE DATABASE ${DB} OWNER handelsbuch;" | q
done
echo "Rolle „handelsbuch“ und Datenbanken handelsbuch / handelsbuch_test bereit."

# ── 4) Abhängigkeiten, Schema, Basis-Instrumente, Build ─────────────────────────
say "Abhängigkeiten (npm)"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
say "Datenbankschema (Migrationen, nicht destruktiv)"
npx prisma generate >/dev/null
DATABASE_URL="$DB_URL" npx prisma migrate deploy
DATABASE_URL="$TEST_URL" npx prisma migrate deploy >/dev/null
say "Basis-Instrumente (Index- und Sektor-ETFs)"
npm run --silent db:bootstrap
say "Produktions-Build"
npm run --silent build >/dev/null
echo "Build fertig."

cat <<'TXT'

✔ Einrichtung abgeschlossen.

Nächste Schritte:
  1. API-Schlüssel in .env eintragen (Anleitung: docs/INSTALLATION_MAC.md, Abschnitt 3).
  2. Dashboard starten:   ./scripts/start-live.sh   → öffnet http://127.0.0.1:3000
  3. Im Dashboard unter „Datenquellen & Einstellungen“ auf „Jetzt aktualisieren“ klicken.
TXT
