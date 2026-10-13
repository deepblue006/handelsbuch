#!/bin/bash
# Startet Dashboard (http://127.0.0.1:3000) und Scheduler gemeinsam; Strg+C beendet beide.
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v brew >/dev/null 2>&1; then
  export PATH="$(brew --prefix node@22)/bin:$(brew --prefix postgresql@16)/bin:$PATH"
  brew services start postgresql@16 >/dev/null 2>&1 || true
fi
[ -f .env ] || { echo "✗ .env fehlt – zuerst: npm run setup:mac"; exit 1; }
[ -d .next ] || { echo "Build fehlt – wird erstellt …"; npm run --silent build >/dev/null; }

npm run --silent start &
APP=$!
trap 'kill $APP 2>/dev/null; wait $APP 2>/dev/null; echo; echo "Dashboard und Scheduler beendet."' EXIT INT TERM

for _ in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:3000 && break; sleep 1; done
echo "Dashboard läuft: http://127.0.0.1:3000  (Beenden: Strg+C)"
command -v open >/dev/null 2>&1 && open http://127.0.0.1:3000 || true

# Scheduler im Vordergrund: Aktualisierung alle REFRESH_INTERVAL_HOURS, Truth Social alle TRUTHSOCIAL_REFRESH_MINUTES
npm run --silent scheduler
