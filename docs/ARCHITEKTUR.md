# Architektur

```
src/
  app/                 Next.js App Router – Seiten (deutsche UI) und Server-Aktionen (actions.ts)
  components/          UI-Bausteine (shadcn-artig, Tailwind), Diagramme (Recharts), Formulare
  proxy.ts             optionaler Zugriffsschutz (Basic Auth)
  lib/
    calc/              reine Finanzberechnungen: Indikatoren, Portfolio (FIFO, FX), Bewertung, Marktbreite,
                       Simulation, Backtest – ohne I/O, vollständig getestet
    rules/             Regelwerk A–D (Definition, Schwellen, Konflikte), konfigurierbar (Zod)
    score/             Kaufsignalscore: Komponenten, Vollständigkeit, Zustände
    providers/         Adapter je Quelle + Register (Kosten, Limits, Bedingungen, Verifikation), HTTP mit Retry/Backoff
    politics/          Radar: Normalisierung, Plausibilität, Deduplizierung, Korrekturen/Versionen, House-Index/PTR-Text
    flows/             ETF-Flows: Import, Mehrquellen-Deduplizierung, Kumulierung, Lücken
    social/            Truth-Social-RSS (nur konfigurierte, zulässige Quelle)
    data/quality.ts    Datenstatus (aktuell, verzögert, zwischengespeichert, veraltet, Snapshot, Demo, fehlt …)
    security/          Schwärzung von Secrets, Export-Bereinigung, Seed-Phrasen-Erkennung
    server/            DB-Zugriff mit Quellenpriorität, Ingest + Abrufprotokoll, Aktualisierungsjobs, Analysen
prisma/                Datenmodell + Migrationen (PostgreSQL)
scripts/               refresh, scheduler, Snapshot-Import, Demo-Seed, Secret-Prüfung, Testdatenbank leeren
tests/                 Vitest (Unit + Integration gegen _test-DB)   e2e/  Playwright
data/snapshots/        echte Alpha-Vantage-Antworten vom 11.10.2026 (Testfixtures + optionaler Import)
index.html             bisheriges Handelsbuch (unverändert, eigenständig nutzbar)
```

## Grundsätze
- **Herkunft an jeder Zeile:** `provider`, `fetchedAt`, Datenstand (`date`), `isDemo`; Fundamentaldaten zusätzlich `filedAt` + Beleg (SEC-Accession).
- **Eine Zeitreihe = ein Provider** (keine stille Vermischung); gewählt wird die jüngste Quelle.
- **Fehlende Werte bleiben `null`**: kein Auffüllen, keine 1:1-Wechselkurse, kein SMA200 aus 100 Tagen.
- **Score:** fehlende Komponenten werden nicht neutral gezählt; Vollständigkeit und effektive Gewichte sind sichtbar; nicht anwendbare Komponenten (Bewertung bei Krypto) werden ausgewiesen.
- **Regeln** liefern AUSGELÖST / NICHT_AUSGELÖST / DATEN_FEHLEN / NICHT_ANWENDBAR und werden nie verrechnet; Konflikte werden ausgewiesen. Krypto: Aktienregeln nicht anwendbar, Charttechnik als „Dashboard-Erweiterung“ gekennzeichnet.
- **Keine Orderausführung**, keine Broker-Zugänge, keine Seed-Phrasen.
- **Splits:** Rohkurse werden beim Lesen (`getBars`) mit der Splitliste des Instruments bereinigt (manuelle Einträge vor Provider-Daten; gespeicherte Kurse bleiben unverändert). Heuristische Split-Warnungen entfallen nur, wenn die Liste als vollständig gilt (Provider-Abruf oder manuelle Bestätigung mit Quelle) **und** kein split-artiger Kurssprung innerhalb ±10 Tagen eines gemeldeten Splits übrig bleibt. Wochenkerzen mit Split in der Woche: Schluss exakt, Open/High/Low näherungsweise.
- **Point-in-Time:** SEC-Werte behalten die zuerst eingereichte Fassung; Fibonacci/Pivots/Backtest nutzen nur Daten bis zum Entscheidungszeitpunkt.

## Datenfluss
Provider-Adapter (parsen + validieren mit Zod) → `server/ingest.ts` (Upsert, FetchLog, ProviderState) →
`server/data.ts` (Lesen mit Priorität) → `server/analysis.ts`/`market.ts`/`portfolio.ts` → Seiten.
Aktualisierung: `npm run refresh` (einmalig) oder `npm run scheduler` (Intervall); Tageskontingente werden über das Abrufprotokoll geprüft.
Alpha Vantage (25/Tag) läuft über einen **Abrufplan** (`providers/av-plan.ts`): Jeder Datensatz hat ein Intervall
(Tageskurse/Makro/Kongress nach jedem US-Handelsschluss, Wochenkurse nach Freitagsschluss, Termine/Konsens/Insider wöchentlich,
13F/Splits monatlich, Krypto nach 00:00 UTC). Fällige Abrufe werden nach Priorität ins Restkontingent gelegt; der Rest wird
mit einem einzigen `SKIPPED`-Protokolleintrag aufgeschoben (zählt weder als Abruf noch als Erfolg). Der Plan ist unter
Einstellungen → „Alpha Vantage – Abrufplan heute“ sichtbar. Handelstage nach regelbasiertem NYSE-Kalender (`calc/us-holidays.ts`, ohne außerplanmäßige Schließungen); Tagesgrenze UTC.
