# Handelsbuch auf dem Mac – Installation und Start

Das Dashboard läuft nur auf deinem Laptop (`http://127.0.0.1:3000`) und ist von außen nicht erreichbar.
Alle Befehle werden im Programm **Terminal** eingegeben (Programme → Dienstprogramme → Terminal).

## 1. Einmalig: Werkzeuge

1. **Apple-Entwicklerwerkzeuge** (bringen `git` mit):
   ```bash
   xcode-select --install
   ```
   Falls „bereits installiert“ gemeldet wird: weiter mit 2.
2. **Homebrew** (Paketverwaltung): den Befehl von <https://brew.sh> ins Terminal kopieren und ausführen.
   Am Ende zeigt Homebrew zwei Zeilen „Next steps“ an – diese ebenfalls ausführen.

## 2. Einmalig: Handelsbuch holen und einrichten

```bash
cd ~
git clone https://github.com/deepblue006/handelsbuch.git
cd handelsbuch
./scripts/setup-mac.sh
```

Falls `git clone` nach Zugangsdaten fragt (privates Repository): mit GitHub Desktop klonen oder
`brew install gh && gh auth login` ausführen und den Befehl wiederholen.

Das Skript installiert Node.js 22 und PostgreSQL 16 über Homebrew, startet die Datenbank (auch automatisch nach
jedem Neustart), legt `.env` mit einem zufälligen lokalen Datenbank-Passwort an, erstellt die Datenbanken,
die Basis-Instrumente (S&P 500, Nasdaq-100, Russell 2000 als ETFs und die 11 Sektor-ETFs) und baut die App.
Es legt **keine** Demodaten an. Dauer beim ersten Mal: etwa 5–10 Minuten.

## 3. Zugangsschlüssel eintragen (alle kostenlos)

Die Datei `.env` im Ordner `handelsbuch` öffnen – **mit einem reinen Texteditor**:

```bash
nano .env        # speichern: ctrl+O, Enter · beenden: ctrl+X
```

> Nicht mit TextEdit öffnen: TextEdit ersetzt gerade Anführungszeichen durch typografische, dann funktionieren die Schlüssel nicht.

Den Schlüssel jeweils zwischen die Anführungszeichen setzen, z. B. `ALPHAVANTAGE_API_KEY="ABC123…"`:

| Eintrag | Woher | Wofür |
|---|---|---|
| `ALPHAVANTAGE_API_KEY` | <https://www.alphavantage.co/support/#api-key> | Kurse, Zinsen, Öl, Gold, EUR/USD, Termine, Schätzungen, Insider, 13F, Kongressmeldungen |
| `FRED_API_KEY` | <https://fred.stlouisfed.org/docs/api/api_key.html> (kostenloses Konto) | Realzins, Konsumstimmung, Staatsverschuldung, Buffett-Indikator |
| `COINGECKO_API_KEY` | <https://www.coingecko.com/en/developers/dashboard> (Demo-Plan) | Krypto-Kurse, Marktkapitalisierung, Allzeithoch, BTC-Dominanz |
| `SEC_USER_AGENT` | kein Schlüssel: `Handelsbuch privat dein.name@beispiel.de` (Name + E-Mail) | US-Fundamentaldaten (Umsatz, Gewinn, Cashflow) |

Die Schlüssel bleiben auf deinem Laptop; sie werden nie angezeigt, protokolliert oder exportiert.
`DASHBOARD_PASSWORD` kannst du leer lassen, solange nur du den Laptop benutzt.

## 4. Starten und beenden

```bash
cd ~/handelsbuch
./scripts/start-live.sh
```

Der Browser öffnet `http://127.0.0.1:3000`. Im Terminal laufen Dashboard **und** Scheduler
(Datenaktualisierung alle 6 Stunden, Truth Social alle 15 Minuten). **Beenden: im Terminal `ctrl+C`.**
Solange das Terminal-Fenster offen ist und der Laptop nicht schläft, aktualisiert sich alles selbst.

## 5. Erste Schritte im Dashboard

1. **Datenquellen & Einstellungen** → „Jetzt aktualisieren“. Danach unten im **Abrufprotokoll** prüfen, was
   geklappt hat. Bei Fehlern: Abrufprotokoll kopieren und mir schicken (enthält keine Schlüssel).
2. **Alpha-Vantage-Kontingent:** 25 Abrufe pro Tag. Der Abrufplan in den Einstellungen zeigt, was heute drankommt;
   der Rest folgt automatisch an den nächsten Tagen. Nach 2–3 Tagen ist alles einmal geladen.
3. **Portfolio** → Bestände erfassen:
   - **Manuell:** Formular „Buchung erfassen“ (Kauf/Verkauf, Datum, Menge, Kurs, Gebühren, ggf. Wechselkurs).
     „Liquidität entsprechend anpassen“ ankreuzen, wenn das Geld vom Verrechnungskonto kommt.
   - **Krypto per CSV:** „CSV-Import“ – erwartete Spalten (Vorlage steht im Formular):
     `datum;typ;symbol;name;assettyp;boerse;waehrung;menge;kurs;gebuehren;gebuehrenwaehrung;wechselkurs_zur_basis;notiz`,
     z. B. `2024-03-01;Kauf;BTC;Bitcoin;Krypto;Börsenaggregat;EUR;0,05;55000;2,5;EUR;;`.
     Es gibt immer erst eine Vorschau; gespeichert wird nur nach Bestätigung.
     Exportiert deine Krypto-Börse ein anderes Format, schick mir **nur die Kopfzeile** (keine echten Werte) –
     dann passe ich den Import an.
   - **CoinGecko-ID:** Für verbreitete Coins (BTC, ETH, SOL, XRP, ADA, DOGE, DOT, LTC, LINK, AVAX, BNB, TRX, XLM,
     USDT, USDC, ATOM, BCH) wird sie automatisch zugeordnet und auf der Detailseite des Coins als „automatisch
     zugeordnet – prüfen“ angezeigt. Andere Coins: auf der Detailseite unter „Position & These“ eintragen
     (steht in der Adresse der Coin-Seite, z. B. `coingecko.com/de/munze/bitcoin` → `bitcoin`).
   - Falls deine Sicherung des alten Handelsbuchs die Buchungen enthält: „Bisheriges Handelsbuch übernehmen“.
4. **Liquidität** unter Portfolio → „Liquidität“ eintragen (für Cashquote und Kaufplan).
5. **Truth Social:** Die Archivquelle ist bereits aktiv; nach der ersten Aktualisierung erscheinen die Posts.

## 6. Längere Kurshistorie (200-Tage-Linie, Tages-RSI, Backtests)

Alpha Vantage liefert kostenlos nur 100 Tageskurse. Für die 200-Tage-Linie eine CSV laden:

- **Stooq** (US-Aktien/ETFs, auch deutsche Werte): <https://stooq.com> → Symbol suchen (US-Werte mit `.us`,
  z. B. `aapl.us`) → unter dem Chart „Download data in csv file“.
- **Nasdaq.com** (nur US-Werte, bis 10 Jahre): `https://www.nasdaq.com/market-activity/stocks/aapl/historical`
  → Zeitraum wählen → „Download historical data“.
- Yahoo Finance bietet den Download nur noch im Bezahl-Abo an.

Dann auf der **Detailseite** des Werts → „Kurshistorie aus CSV importieren“ → Datei wählen → Importieren.
Die Detailseite verlinkt Stooq und Nasdaq direkt für den jeweiligen Wert.

## 7. Updates

```bash
cd ~/handelsbuch
git pull
./scripts/setup-mac.sh     # installiert/migriert nur, was fehlt; deine Daten bleiben erhalten
```

## 8. Datensicherung

```bash
mkdir -p ~/Handelsbuch-Backups
/opt/homebrew/opt/postgresql@16/bin/pg_dump -Fc handelsbuch > ~/Handelsbuch-Backups/handelsbuch-$(date +%F).dump
```

Wiederherstellen (überschreibt den aktuellen Stand):

```bash
/opt/homebrew/opt/postgresql@16/bin/pg_restore --clean --if-exists -d handelsbuch ~/Handelsbuch-Backups/handelsbuch-JJJJ-MM-TT.dump
```

(Bei Intel-Macs liegt Homebrew unter `/usr/local` statt `/opt/homebrew`.)

## 9. Wenn etwas nicht klappt

| Meldung | Lösung |
|---|---|
| `command not found: npm` | Immer `./scripts/start-live.sh` bzw. `./scripts/setup-mac.sh` verwenden – die Skripte setzen den Pfad selbst. |
| „PostgreSQL antwortet nicht“ | `brew services restart postgresql@16`, dann erneut starten. |
| „Port 3000 belegt“ / `EADDRINUSE` | Altes Terminal-Fenster mit laufendem Dashboard schließen oder `lsof -ti:3000 | xargs kill`. |
| Werte „Zugang fehlt“ | Schlüssel in `.env` prüfen (gerade Anführungszeichen), Dashboard neu starten. |
| „Tageskontingent erschöpft“ | Normal bei Alpha Vantage Free – der Rest kommt am nächsten Tag. |
