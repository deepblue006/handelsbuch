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
| Charttechnik (SMA 50/100/200, EMA 10/20, 30W/200W, RSI 14/5, Stage-Analyse, Golden/Death Cross, Fibonacci, Zonen, runde Marken, ADR, Volumen, Splitwarnung) | implementiert und getestet; SMA200 (Tage) braucht ≥ 200 Tageskurse → mit Alpha Vantage Free nicht abrufbar, aber per **Kurs-CSV-Import** (eigener Export) möglich |
| Spread/Orderbuch | Spread-Formel implementiert und getestet; **Daten nicht verfügbar** (kein Zugang) |
| Fair Value (3 Szenarien, 1–2 J. und 2030), Sensitivität, Rückwärtsrechnung, PEG, FCF-Rendite, EV/Sales, Branchenhinweise | implementiert und getestet; Annahmen manuell |
| Regelwerk A–D mit Konflikten, Kaufsignalscore mit Vollständigkeit und 7 Zuständen | implementiert und getestet |
| Marktlage: Index-ETF-Proxys, Stage, Abstand zum Hoch, Zinsen, Fed Funds, Öl, Gold, EUR/USD | implementiert; mit **echtem Alpha-Vantage-Snapshot** (11.10.2026) geprüft – laufender Abruf: Zugang fehlt |
| Realzins, Konsumklima, Staatsverschuldung, Buffett-Näherung (FRED) | implementiert, Zugang fehlt (nicht verifiziert) |
| Marktbreite (% über SMA200) | implementiert und getestet; eigenes Universum braucht Tageskurse für ≥ 20 Titel (Premium-Abruf oder Kurs-CSV-Import); alternativ manuell erfasste externe Breite mit Quellenpflicht (≤ 7 Tage alt) |
| Sektorrotation (11 SPDR-Sektor-ETFs, relative Stärke 4/13/26/52 W, Split-Prüfung je Fenster) und Saisonalität (Monatsstatistik SPY) | implementiert und mit echten Wochenkursen (Snapshot 13.10.2026) getestet; Sektor-**Flüsse** nicht angebunden |
| Fundamentaldaten (SEC XBRL, Point-in-Time) | implementiert, Zugang fehlt (nicht verifiziert) |
| Quartalstermine (Alpha Vantage) | Format verifiziert, Zugang fehlt; FOMC-Termine statisch (gegenprüfen) |
| Konsensschätzungen → Forward-KGV, PEG, Schätzungsrevisionen (Alpha Vantage) | implementiert und mit echtem Auszug getestet; laufender Abruf: Zugang fehlt |
| Insidertransaktionen (Form-4-Codes) und 13F-Beteiligungen (Alpha Vantage) | implementiert und mit echtem Auszug getestet; Meldedatum fehlt in der Quelle, 13F-Stichtage gemischt (gekennzeichnet) |
| Zinserwartungen: Kalshi | implementiert, nicht verifiziert, standardmäßig aus · CME FedWatch: noch nicht implementiert (kostenpflichtig) |
| ETF-/ETP-Flows (Import, Deduplizierung, Kumulierung, Lücken) | implementiert und getestet; kein automatischer Abruf (keine verifizierte API) |
| Politiker-Radar: Sekundärquelle Alpha Vantage | implementiert und mit echten Daten (NVDA) getestet |
| Politiker-Radar: House-Clerk-Index, automatische PDF-Textextraktion (gedrosselt), PDF-Upload, Prüfwarteschlange, Versionen | implementiert und mit synthetischen PDFs getestet (E2E); Abruf echter House-Dokumente nicht verifiziert (Host gesperrt); gescannte PDFs → „OCR nötig“ |
| Senate eFD, OGE | kein automatischer Abruf; manuelle Meldung mit offiziellem Link + PDF-Upload implementiert |
| Krypto über CoinGecko Demo-API (Kurs mit Anbieter-Zeitstempel, Marktkapitalisierung, Volumen, Umlauf, Allzeithoch, 365 Tageskurse, Gesamtmarkt/BTC-Dominanz; Monatskontingent, Quellennennung) / Alpha Vantage als Ersatz | implementiert und mit synthetischen Antworten getestet (Unit, DB-Integration, E2E-Leerzustände); **live ungeprüft** – `api.coingecko.com` in der Sandbox gesperrt; Auth/Grenzen über Doku-Auszüge bestätigt, `/coins/markets`-Feldnamen nicht. Alpha-Vantage-Format verifiziert (BTC/EUR-Snapshot) |
| On-Chain-Kennzahlen | noch nicht implementiert |
| Truth Social | Posts im Dashboard über den öffentlichen RSS-Feed des Archivs „Trump's Truth“ (trumpstruth.org), per Klick aktivierbar, Abruf alle 15 min, Link zum Original; kein Abruf von truthsocial.com (Nutzungsbedingungen). Mit synthetischem Feed getestet; **live ungeprüft** (Host in der Sandbox gesperrt) |
| Kaufplan, Sparpläne, Tranchen, Rücksetzer-/KI-Stressszenario, Kaufsimulation | implementiert und getestet |
| Buchung passt Liquidität optional an | implementiert und getestet (E2E) |
| Backtest (ohne Look-ahead, Mindeststichprobe, Splitprüfung) | implementiert und getestet |
| Alpha-Vantage-Abrufplan (Intervall je Datensatz, Priorität im 25er-Tageskontingent, Aufschub statt Fehlschlag, Anzeige in den Einstellungen) | implementiert und getestet (Unit, DB-Integration, E2E); regelbasierter NYSE-Feiertagskalender, außerplanmäßige Schließungen nicht erfasst |
| Split-Bereinigung von Rohkursen (Splitliste je Instrument: manuell mit Pflichtquelle oder Alpha Vantage `SPLITS`; Abgleich mit Kurssprüngen) | implementiert und getestet (u. a. echte AAPL-Wochenkurse mit den vier dokumentierten Splits); **`SPLITS`-Antwortformat live noch nicht geprüft** (Tageslimit am 13.10.2026 erschöpft) |
| Docker Compose (db, app, scheduler) | `db` inkl. Init-Skript, Migrationen und Snapshot-Import im Container getestet; **App-Image-Build nicht getestet** (Debian-Spiegel in der Sandbox gesperrt) |
| Datenstatus, Abrufprotokoll, Retry/Backoff, Ratenbegrenzung, Secret-Schwärzung, Basic Auth | implementiert und getestet |
