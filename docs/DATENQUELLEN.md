# Datenquellen – Bewertung (Prüfstand 11.10.2026)

**Wichtig zur Prüfmethode:** Die Entwicklungsumgebung hatte eine Egress-Policy, die alle Finanzdaten-Hosts
blockierte (HTTP 403 am Proxy für u. a. fred.stlouisfed.org, federalreserve.gov, alphavantage.co,
api.coingecko.com, sec.gov, disclosures-clerk.house.gov, efdsearch.senate.gov, truthsocial.com, farside.co.uk,
sosovalue.com, defillama.com, finviz.com, cmegroup.com, kalshi.com, data-api.ecb.europa.eu).
Geprüft wurde daher über (a) Websuche in offiziellen Seiten/Dokus und (b) für **Alpha Vantage** über eine
angebundene MCP-Schnittstelle mit echten Antworten (gespeichert unter `data/snapshots/alphavantage`).

Legende Verifikation: **FORMAT_VERIFIZIERT** = echte Antwort liegt vor · **UNGEPRÜFT** = Adapter nach Doku,
nicht live getestet · **NICHT_IMPLEMENTIERT** = bewusst kein Adapter · **NUR_LINK** = Verweis/manuell.

| Quelle | Zweck | Zugang/Kosten | Limits | Bedingungen / Einschränkungen | Status |
|---|---|---|---|---|---|
| Alpha Vantage | Kurse (Tag/Woche), 10J-Rendite, Fed Funds, WTI/Brent, Gold, EUR/USD, Earnings-Kalender, Kongressmeldungen (aggregiert), Krypto | Free-Key; Premium ab ca. 49,99 USD/Monat (Drittangabe) | **25/Tag, 1/s** (API-Fehlermeldung); `TIME_SERIES_DAILY outputsize=full` **Premium** → nur 100 Tageskurse; `COMPANY_OVERVIEW` für den Key als Premium gemeldet | Rohkurse nicht split-bereinigt (AAPL-Splits 2014/2020 im Snapshot sichtbar); Kongressdaten = Sekundärquelle | FORMAT_VERIFIZIERT |
| FRED (St. Louis Fed) | DGS10, DFF (H.15), DFII10, T10YIE, Öl, DEXUSEU, UMCSENT, GFDEGDQ188S, NCBEILQ027S+GDP | kostenloser Key | laut Drittquellen 120/min (offiziell: „rate limited“) | einzelne Reihen mit Rechten der Ursprungsquelle | UNGEPRÜFT |
| Federal Reserve H.15 / FOMC-Kalender | Zinsen (Ursprung von DGS10/DFF), Sitzungstermine | frei | – | öffentlich | Termine statisch, abgeglichen mit Chicago Fed/MNI (Sekundär) |
| EZB Data Portal | EUR/USD-Referenzkurs | frei, kein Key | nicht geprüft | Quellenangabe | UNGEPRÜFT |
| SEC EDGAR (XBRL companyfacts, company_tickers) | Umsatz, GAAP-Gewinn, OCF, Capex, SBC, Aktien, Rückkäufe, Cash, Schulden – mit **Einreichungsdatum** | frei | **max. 10/s**, User-Agent mit Kontakt Pflicht (offizielle SEC-Seite) | Fair-Access-Policy | UNGEPRÜFT |
| CoinGecko | Krypto-Kurse/Marktkapitalisierung | Demo: 10.000 Credits/Monat, **Attribution**, keine kommerzielle Lizenz | Changelog 17.05.2026: 100/min (Preisseite: 30/min) | – | UNGEPRÜFT |
| CryptoCompare | Krypto | – | – | in dieser Runde nicht weiter geprüft; Alpha Vantage + CoinGecko decken Kurse ab | nicht geprüft |
| DefiLlama | TVL/Protokolle; ETF-Seite | frei; Pro 300 USD/Monat, Supporter 15 USD/Monat | frei 10–200/min | ETF-Endpunkt **nicht dokumentiert auffindbar** | NICHT_IMPLEMENTIERT |
| Farside Investors | US-Spot-BTC/ETH-ETF-Flows | Website, keine API | – | laut Farside **Schätzwerte**, „Fokus auf Geschwindigkeit statt Genauigkeit“; Weitergabebedingungen nicht gefunden | Import per Einfügen |
| SoSoValue | ETF-Flows | offizielle API-Doku nicht auffindbar | – | – | NICHT_IMPLEMENTIERT |
| CME FedWatch API | Zinswahrscheinlichkeiten | **ab 25 USD/Monat** (CME), OAuth-Freischaltung | tarifabhängig | Lizenz | NICHT_IMPLEMENTIERT |
| Kalshi | Kontraktpreise zu Fed-Entscheidungen | Marktdaten ohne Auth (offizielle Doku) | ca. 10/s (Drittquelle) | Preise ≠ Prognose; Serie `KXFED` nur aus Drittquelle | UNGEPRÜFT, standardmäßig aus |
| Financial Modeling Prep | Schätzungen, Ratings | Free 250/Tag (Drittangaben) | – | Anzeige/Weitergabe laut Vergleichsseite gesondert | NICHT_IMPLEMENTIERT |
| Finviz (Elite) | Gruppen, Heatmaps, Screener | ca. 39,50 USD/Monat (Drittangabe) | Elite-API 10 Anfragen/5 s (offizieller Blog) | Scraping nicht vorgesehen | NUR_LINK |
| House Clerk Financial Disclosure | PTR-Index (XML im Jahres-ZIP), PTR-PDFs | frei | – | STOCK Act § 8; gesetzliche Nutzungsbeschränkungen (u. a. keine kommerzielle Nutzung) | UNGEPRÜFT; PDF-Text per Einfügen |
| Senate eFD | PTR (Webformulare) | frei | – | Nutzungsvereinbarung im Browser; automatisierte Nutzung nicht als zulässig verifiziert | NICHT_IMPLEMENTIERT (Link) |
| OGE | 278e/278-T | teils auf Antrag | – | – | NUR_LINK |
| Truth Social | öffentliche Posts | **keine öffentliche, offiziell dokumentierte API**; Lizenzzugang nur für ausgewählte Firmen (Medienbericht) | – | Scraping laut Berichten untersagt, Betreiber blockiert Scraper | kein Abruf; optionale vom Nutzer geprüfte RSS-URL |
| TradingView, InvestingPro, Aktienfinder, Eulerpool, aktien.guide, Onvista, finanzen.net, Earnings Whispers, State Street SPDR | Charts, Fundamentaldaten, Termine, Sektor-ETFs | Abos ohne dokumentierte freie API | – | Scraping nicht implementiert | NUR_LINK / manuelle Werte |

## Belege (Auswahl)
- SEC Fair Access: https://www.sec.gov/os/accessing-edgar-data
- CoinGecko Preise/Changelog: https://www.coingecko.com/en/api/pricing · https://docs.coingecko.com/changelog.md
- DefiLlama Pro: https://docs.llama.fi/pro-api
- Farside BTC-Tabelle (Hinweise zu Schätzwerten): https://farside.co.uk/?p=997
- CME FedWatch API: https://www.cmegroup.com/market-data/market-data-api/fedwatch-api.html
- Kalshi Marktdaten: https://docs.kalshi.com/getting_started/quick_start_market_data
- Finviz API: https://finviz.com/blog/our-upgraded-api-higher-limits-clearer-data-and-more-ways-to-connect/
- Alpha Vantage Premium/Limits: https://www.alphavantage.co/premium
- Truth Social API-Bericht: https://www.gigazine.net/gsc_news/en/20260717-truth-social-api/
- FOMC 2026: https://www.chicagofed.org/utilities/about-us/federal-reserve-calendars · 2027: MNI-Meldung
- House Clerk: https://disclosures-clerk.house.gov/FinancialDisclosure · Senate eFD: https://efdsearch.senate.gov/search/

## Festgestellte Datenlücken mit Auswirkung
1. **200-Tage-Linie** für Aktien/Index-ETFs: mit Alpha Vantage Free nicht berechenbar (100 Tageskurse). Ersatzweise wird die **40-Wochen-Linie als gekennzeichnete Näherung** gezeigt; Regeln C5 und A1 bleiben ohne Tagesdaten „Daten fehlen“.
2. **Marktbreite** (% Aktien über SMA200): benötigt Tageskurse für ein Universum (idealerweise Indexmitglieder). Mit Free-Limits praktisch nicht machbar → Premium-Provider oder manuelle externe Breite (`BREADTH_EXTERNAL`) nötig.
3. **Forward-KGV, Analystenschätzungen, Ratings**: keine freie, lizenzierte Quelle verifiziert → manuell im Bewertungsmodell/Analystenformular.
4. **Geld-/Briefkurse, Orderbuch**: kein Zugang → nicht verfügbar, wird nicht simuliert.
5. **ETF-Flows**: keine verifizierte API → Import der Farside-Tabelle.
6. **Indexstände**: S&P 500/Nasdaq-100/Russell 2000 über ETF-Proxys (SPY/QQQ/IWM), gekennzeichnet.
