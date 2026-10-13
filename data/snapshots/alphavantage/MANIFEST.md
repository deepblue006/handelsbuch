# Alpha-Vantage-Snapshots (echte Antworten)

Abgerufen am **11.10.2026 zwischen ca. 14:19 und 14:24 UTC** über die Alpha-Vantage-MCP-Schnittstelle
(Free-Key), weil der direkte Netzwerkzugriff der Entwicklungsumgebung auf alphavantage.co durch die
Egress-Policy gesperrt war. Die Dateien sind unveränderte Rohantworten – mit einer Ausnahme:
`FX_DAILY_EURUSD_LAST10.json` enthält nur die letzten 10 Handelstage der Antwort (gekürzt, Werte unverändert).

| Datei | Funktion | Datenstand | Hinweise |
|---|---|---|---|
| TIME_SERIES_WEEKLY_SPY/QQQ/IWM/AAPL.json | TIME_SERIES_WEEKLY | 09.10.2026 | Rohkurse, **nicht split-bereinigt** (AAPL: Splits 2014 und 2020 sichtbar) |
| DIGITAL_CURRENCY_DAILY_BTC_EUR.json | DIGITAL_CURRENCY_DAILY | 11.10.2026 00:00 UTC | letzter Tag unvollständig (laufender UTC-Tag) |
| TREASURY_YIELD_10Y_DAILY.json | TREASURY_YIELD (10year, daily) | 08.10.2026 | „.“ = kein Wert (Feiertage) |
| FEDERAL_FUNDS_RATE_DAILY.json | FEDERAL_FUNDS_RATE (daily) | 08.10.2026 | |
| WTI_DAILY.json | WTI (daily) | 06.10.2026 | |
| GOLD_DAILY.json | GOLD_SILVER_HISTORY (GOLD, daily) | 10.10.2026 | |
| CONGRESS_TRADES_NVDA.json | CONGRESS_TRADES (NVDA) | Einreichungen bis 10.09.2026 | Sekundärquelle (aggregiert) |
| FX_DAILY_EURUSD_LAST10.json | FX_DAILY EUR/USD | 09.10.2026 | gekürzt auf 10 Tage |

Festgestellte Einschränkungen des Free-Keys (Fehlermeldungen der API am 11.10.2026):
- `TIME_SERIES_DAILY` mit `outputsize=full` ist Premium → nur 100 Tageskurse (SMA200 nicht berechenbar).
- `COMPANY_OVERVIEW` wurde als Premium-Endpunkt gemeldet.
- Limit 25 Anfragen/Tag, 1 Anfrage/Sekunde.

Nutzung: `npm run db:import-snapshot` lädt diese Dateien über die regulären Parser in die Datenbank
(Provider `alphavantage_snapshot`). Im Dashboard sind sie als „Snapshot“ gekennzeichnet.
Weitergabe der Rohdaten unterliegt den Nutzungsbedingungen von Alpha Vantage.

## Ergänzung 13.10.2026 (Abruf ca. 14:15–14:20 UTC, gleicher Weg)
| Datei | Funktion | Hinweise |
|---|---|---|
| BRENT_DAILY.json | BRENT (daily) | vollständige Rohantwort |
| EARNINGS_ESTIMATES_AAPL_EXCERPT.json | EARNINGS_ESTIMATES | **Auszug** (4 von 38 Einträgen, Werte unverändert); historische Quartalsschätzungen sind nicht split-bereinigt (z. B. 2019: 4,55 USD) |
| INSIDER_TRANSACTIONS_AAPL_EXCERPT.json | INSIDER_TRANSACTIONS | **Auszug** (6 von 91 Einträgen ab 01.04.2026); Feld `acquisition_or_disposal` enthält Form-4-Transaktionscodes; **kein Meldedatum** |
| INSTITUTIONAL_HOLDINGS_AAPL_EXCERPT.json | INSTITUTIONAL_HOLDINGS | **Auszug** (Kopfdaten + 2 von 6.423 Haltern); Stichtage je Halter unterschiedlich |
