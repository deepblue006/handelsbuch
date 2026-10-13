# Installation & Betrieb

## Voraussetzungen
Node.js 22, PostgreSQL 16 (oder Docker), optional API-Schlüssel (siehe `.env.example`).

## Lokal starten (ohne Docker)
```bash
npm ci
cp .env.example .env          # DATABASE_URL anpassen, Schlüssel eintragen
createdb handelsbuch && createdb handelsbuch_test   # bzw. per psql
npx prisma migrate deploy
npm run db:import-snapshot    # optional: echte Alpha-Vantage-Snapshots vom 11.10.2026 (als „Snapshot“ markiert)
npm run db:seed:demo          # optional: DEMO-Portfolio (deutlich markiert); entfernen: npm run db:seed:demo -- --remove
npm run build && npm start    # http://127.0.0.1:3000
npm run refresh               # Daten aller aktivierten, konfigurierten Provider laden
```
Entwicklung: `npm run dev`. Bisheriges Handelsbuch: Sicherung dort herunterladen und unter Portfolio → „Bisheriges Handelsbuch übernehmen“ importieren.

## Mit Docker Compose
```bash
cp .env.example .env   # POSTGRES_PASSWORD in der Shell oder .env setzen
docker compose up -d --build
```
Dienste: `db` (nur 127.0.0.1:5432), `app` (127.0.0.1:3000), `scheduler` (Aktualisierung alle `REFRESH_INTERVAL_HOURS`).

## Tests
```bash
npm test                         # Unit-Tests (Vitest)
TEST_DATABASE_URL=… npm run test:integration    # gegen Datenbank mit Suffix _test
npm run build && E2E_DATABASE_URL=… npm run test:e2e   # Playwright; leert NUR *_test-Datenbanken
npm run typecheck && npm run check:secrets
```

## Sicherheit
- Standardmäßig nur an 127.0.0.1 gebunden. Für Zugriff von außen `DASHBOARD_PASSWORD` setzen und hinter HTTPS betreiben.
- Secrets nur über Umgebungsvariablen; Fehlermeldungen/Protokolle werden geschwärzt; Einstellungen zeigen nur „konfiguriert / fehlt“.
- Eingaben, Uploads und externe Dokumente gelten als nicht vertrauenswürdig: Zod-Validierung, Größenlimits, XML ohne Entitätsexpansion, ZIP-Größenprüfung, Ablehnung von Seed-Phrasen/privaten Schlüsseln.
- Portfoliodaten werden an keine externen KI-Dienste gesendet.

## Hinter einem Proxy
Node-`fetch` nutzt `HTTPS_PROXY` nur mit `NODE_USE_ENV_PROXY=1`.

## Bekannte Grenzen
Siehe Abschlussbericht im README.
