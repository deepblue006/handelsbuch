# Handelsbuch – persönliches Investment-Dashboard

Analyse- und Entscheidungshilfe für Aktien, ETFs und Krypto (Next.js, TypeScript strict, Tailwind, Recharts,
PostgreSQL/Prisma, Zod, Vitest, Playwright). **Keine automatische Orderausführung, keine Anlageberatung.**
Referenzregeln stammen aus der Nutzer-Zusammenstellung „Marktdaten, die Finanzwiesel nutzt“ (Stand 11.10.2026)
und sind konfigurierbare Startparameter.

- Installation & Betrieb: [docs/BETRIEB.md](docs/BETRIEB.md)
- Datenquellen, Kosten, Bedingungen, Lücken: [docs/DATENQUELLEN.md](docs/DATENQUELLEN.md)
- Architektur & Grundsätze: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)
- Das bisherige Ein-Datei-Handelsbuch (`index.html`) bleibt unverändert nutzbar; seine Sicherung lässt sich importieren.

## Modulstatus

| Modul | Status |
|---|---|
| Portfolio (FIFO, Handels-/Basiswährung, Kurs- vs. Währungseffekt, Dividenden/Gebühren getrennt, Krypto-Haltefristen, Gewichte, Klumpenrisiko) | implementiert und getestet |
| Manuelle Buchung, CSV-Import mit Vorschau, Übernahme des alten Handelsbuchs | implementiert und getestet (E2E) |
| Charttechnik (SMA 50/100/200, EMA 10/20, 30W/200W, RSI 14/5, Stage-Analyse, Golden/Death Cross, Fibonacci, Zonen, runde Marken, ADR, Volumen, Splitwarnung) | implementiert und getestet; SMA200 (Tage) braucht ≥ 200 Tageskurse → mit Alpha Vantage Free nicht verfügbar |
| Spread/Orderbuch | Spread-Formel implementiert und getestet; **Daten nicht verfügbar** (kein Zugang) |
| Fair Value (3 Szenarien, 1–2 J. und 2030), Sensitivität, Rückwärtsrechnung, PEG, FCF-Rendite, EV/Sales, Branchenhinweise | implementiert und getestet; Annahmen manuell |
| Regelwerk A–D mit Konflikten, Kaufsignalscore mit Vollständigkeit und 7 Zuständen | implementiert und getestet |
| Marktlage: Index-ETF-Proxys, Stage, Abstand zum Hoch, Zinsen, Fed Funds, Öl, Gold, EUR/USD | implementiert; mit **echtem Alpha-Vantage-Snapshot** (11.10.2026) geprüft – laufender Abruf: Zugang fehlt |
| Realzins, Konsumklima, Staatsverschuldung, Buffett-Näherung (FRED) | implementiert, Zugang fehlt (nicht verifiziert) |
| Marktbreite (% über SMA200) | implementiert und getestet; **Datenbasis fehlt** (Tageskurse eines Universums) |
| Fundamentaldaten (SEC XBRL, Point-in-Time) | implementiert, Zugang fehlt (nicht verifiziert) |
| Quartalstermine (Alpha Vantage) | Format verifiziert, Zugang fehlt; FOMC-Termine statisch (gegenprüfen) |
| Zinserwartungen: Kalshi | implementiert, nicht verifiziert, standardmäßig aus · CME FedWatch: noch nicht implementiert (kostenpflichtig) |
| ETF-/ETP-Flows (Import, Deduplizierung, Kumulierung, Lücken) | implementiert und getestet; kein automatischer Abruf (keine verifizierte API) |
| Politiker-Radar: Sekundärquelle Alpha Vantage | implementiert und mit echten Daten (NVDA) getestet |
| Politiker-Radar: House-Clerk-Index, PTR-Text-Extraktion, Prüfwarteschlange, Versionen | teilweise implementiert; Index-Abruf nicht verifiziert; PDF-Text per Einfügen |
| Senate eFD, OGE | noch nicht implementiert (nur Links/manuell) |
| Krypto-Kurse (CoinGecko / Alpha Vantage) | CoinGecko nicht verifiziert; Alpha-Vantage-Format verifiziert (BTC/EUR-Snapshot) |
| On-Chain-Kennzahlen | noch nicht implementiert |
| Truth Social | kein Live-Feed (keine zulässige Quelle verifiziert); optionaler RSS-Import implementiert, nicht verifiziert |
| Kaufplan, Sparpläne, Tranchen, Rücksetzer-/KI-Stressszenario, Kaufsimulation | implementiert und getestet |
| Backtest (ohne Look-ahead, Mindeststichprobe, Splitprüfung) | implementiert und getestet |
| Datenstatus, Abrufprotokoll, Retry/Backoff, Ratenbegrenzung, Secret-Schwärzung, Basic Auth | implementiert und getestet |
