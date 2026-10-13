/**
 * Lädt die echten Alpha-Vantage-Snapshots (data/snapshots/alphavantage) über die regulären Parser
 * in die Datenbank. Provider: "alphavantage_snapshot" – im Dashboard als Snapshot gekennzeichnet.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { parseTimeSeries, parseEconomic, parseGoldSilver, parseFxDaily, parseCongressTrades, parseEarningsEstimates, parseInsiderTransactions, parseInstitutionalHoldings, parseSplits } from "../src/lib/providers/alphavantage";
import { fromAlphaVantage } from "../src/lib/politics/normalize";
import { ensureInstrument, upsertBars, upsertMacro, ingestPoliticianTx, withFetchLog, upsertEstimates, upsertInsider, upsertInstitutional, upsertSplits } from "../src/lib/server/ingest";
import { SNAPSHOT_PROVIDER } from "../src/lib/server/data";
import { SECTOR_ETFS, SECTOR_ETF_TAG } from "../src/lib/server/market";

const DIR = path.resolve(__dirname, "../data/snapshots/alphavantage");
const FETCHED_AT = new Date("2026-10-11T14:22:00Z"); // Abrufzeitraum ca. 14:19–14:24 UTC (siehe MANIFEST.md)
const TODAY = "2026-10-11";
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));

async function main() {
  const proxies = [
    { symbol: "SPY", name: "SPDR S&P 500 ETF Trust (Proxy S&P 500)", exchange: "NYSE Arca" },
    { symbol: "QQQ", name: "Invesco QQQ Trust (Proxy Nasdaq-100)", exchange: "NASDAQ" },
    { symbol: "IWM", name: "iShares Russell 2000 ETF (Proxy Russell 2000)", exchange: "NYSE Arca" },
  ];
  for (const p of proxies) {
    const inst = await ensureInstrument({ ...p, assetType: "INDEX_PROXY", currency: "USD", providerIds: { alphavantage: p.symbol } });
    await withFetchLog(SNAPSHOT_PROVIDER, `weekly:${p.symbol}`, async () => {
      const s = parseTimeSeries(load(`TIME_SERIES_WEEKLY_${p.symbol}.json`), "WEEK", "USD", TODAY);
      return { received: s.bars.length, processed: await upsertBars(inst.id, s, SNAPSHOT_PROVIDER, FETCHED_AT, { skipPartial: true }) };
    });
  }
  const aapl = await ensureInstrument({ symbol: "AAPL", name: "Apple Inc.", assetType: "STOCK", currency: "USD", exchange: "NASDAQ", sector: "Technologie", providerIds: { alphavantage: "AAPL" }, onWatchlist: true });
  await withFetchLog(SNAPSHOT_PROVIDER, "weekly:AAPL", async () => {
    const s = parseTimeSeries(load("TIME_SERIES_WEEKLY_AAPL.json"), "WEEK", "USD", TODAY);
    return { received: s.bars.length, processed: await upsertBars(aapl.id, s, SNAPSHOT_PROVIDER, FETCHED_AT, { skipPartial: true }) };
  });
  const btc = await ensureInstrument({ symbol: "BTC", name: "Bitcoin", assetType: "CRYPTO", currency: "EUR", exchange: "Börsenaggregat", providerIds: { alphavantage: "BTC", coingecko: "bitcoin" }, onWatchlist: true });
  await withFetchLog(SNAPSHOT_PROVIDER, "crypto:BTC", async () => {
    const s = parseTimeSeries(load("DIGITAL_CURRENCY_DAILY_BTC_EUR.json"), "DAY", "EUR", TODAY);
    return { received: s.bars.length, processed: await upsertBars(btc.id, s, SNAPSHOT_PROVIDER, FETCHED_AT, { skipPartial: true }), note: s.partialLastBar ? "laufender UTC-Tag 2026-10-11 nicht übernommen" : undefined };
  });
  const macros: [string, string, (j: unknown) => ReturnType<typeof parseEconomic>, { name: string; unit: string; originalSource: string }][] = [
    ["US10Y", "TREASURY_YIELD_10Y_DAILY.json", (j) => parseEconomic(j, "US10Y"), { name: "Rendite 10-jähriger US-Staatsanleihen", unit: "%", originalSource: "Federal Reserve H.15 (über Alpha Vantage)" }],
    ["EFFR", "FEDERAL_FUNDS_RATE_DAILY.json", (j) => parseEconomic(j, "EFFR"), { name: "Effective Federal Funds Rate", unit: "%", originalSource: "Federal Reserve H.15 (über Alpha Vantage)" }],
    ["WTI", "WTI_DAILY.json", (j) => parseEconomic(j, "WTI"), { name: "WTI Rohöl", unit: "USD je Barrel", originalSource: "U.S. EIA (über Alpha Vantage)" }],
    ["BRENT", "BRENT_DAILY.json", (j) => parseEconomic(j, "BRENT"), { name: "Brent Rohöl", unit: "USD je Barrel", originalSource: "U.S. EIA (über Alpha Vantage)" }],
    ["GOLD_USD", "GOLD_DAILY.json", (j) => parseGoldSilver(j, "GOLD_USD"), { name: "Gold (XAU/USD)", unit: "USD je Feinunze", originalSource: "Alpha Vantage" }],
    ["EURUSD", "FX_DAILY_EURUSD_LAST10.json", (j) => parseFxDaily(j, "EURUSD"), { name: "EUR/USD Tagesschluss (nur 10 Tage im Snapshot)", unit: "USD je EUR", originalSource: "Alpha Vantage FX_DAILY" }],
  ];
  for (const [key, file, parse, meta] of macros) {
    await withFetchLog(SNAPSHOT_PROVIDER, `macro:${key}`, async () => {
      const d = parse(load(file));
      return { received: d.points.length, processed: await upsertMacro({ key, ...meta, provider: SNAPSHOT_PROVIDER, frequency: "daily", sourceUrl: "https://www.alphavantage.co/documentation/" }, d, FETCHED_AT, "2000-01-01") };
    });
  }
  const FETCHED_13 = new Date("2026-10-13T14:17:00Z");
  for (const [sym, label] of SECTOR_ETFS) {
    const inst = await ensureInstrument({ symbol: sym, name: `SPDR ${label} (Sektor-ETF)`, assetType: "ETF", currency: "USD", exchange: "NYSE Arca", sector: label, providerIds: { alphavantage: sym } });
    if (inst.industry !== SECTOR_ETF_TAG) await prisma.instrument.update({ where: { id: inst.id }, data: { industry: SECTOR_ETF_TAG } });
    await withFetchLog(SNAPSHOT_PROVIDER, `weekly:${sym}`, async () => {
      const s = parseTimeSeries(load(`TIME_SERIES_WEEKLY_${sym}.json`), "WEEK", "USD", "2026-10-13");
      return { received: s.bars.length, processed: await upsertBars(inst.id, s, SNAPSHOT_PROVIDER, new Date("2026-10-13T14:40:00Z"), { skipPartial: true }), note: s.partialLastBar ? "laufende Woche verworfen" : undefined };
    });
  }
  await withFetchLog(SNAPSHOT_PROVIDER, "estimates:AAPL", async () => { const e = parseEarningsEstimates(load("EARNINGS_ESTIMATES_AAPL_EXCERPT.json")); return { received: e.length, processed: await upsertEstimates(aapl.id, e, SNAPSHOT_PROVIDER, FETCHED_13), note: "Auszug" }; });
  await withFetchLog(SNAPSHOT_PROVIDER, "insider:AAPL", async () => { const t = parseInsiderTransactions(load("INSIDER_TRANSACTIONS_AAPL_EXCERPT.json")); return { received: t.length, processed: await upsertInsider(aapl.id, t, SNAPSHOT_PROVIDER, FETCHED_13), note: "Auszug" }; });
  await withFetchLog(SNAPSHOT_PROVIDER, "institutional:AAPL", async () => { const r = parseInstitutionalHoldings(load("INSTITUTIONAL_HOLDINGS_AAPL_EXCERPT.json")); return { received: r.holdings.length, processed: await upsertInstitutional("AAPL", r, SNAPSHOT_PROVIDER, FETCHED_13), note: "Auszug" }; });
  const nvda = await ensureInstrument({ symbol: "NVDA", name: "NVIDIA Corporation", assetType: "STOCK", currency: "USD", exchange: "NASDAQ", sector: "Halbleiter", providerIds: { alphavantage: "NVDA" }, onWatchlist: true });
  void nvda;
  await withFetchLog(SNAPSHOT_PROVIDER, "congress:NVDA", async () => {
    const r = parseCongressTrades(load("CONGRESS_TRADES_NVDA.json"));
    const c = await ingestPoliticianTx(r.trades.map(fromAlphaVantage), FETCHED_AT, TODAY);
    console.log("Kongressmeldungen:", c);
    return { received: r.trades.length, processed: r.trades.length };
  });
  // Splitlisten (SPLITS_<SYMBOL>.json), sofern als Snapshot vorhanden
  for (const f of fs.readdirSync(DIR).filter((x) => /^SPLITS_[A-Z.]+\.json$/.test(x))) {
    const sym = f.slice(7, -5);
    const inst = await prisma.instrument.findUnique({ where: { symbol: sym } });
    if (!inst) continue;
    // Abrufzeitpunkt muss im Snapshot stehen (Feld _fetchedAt), Dateizeiten sind nach git checkout bedeutungslos
    const raw = load(f) as { _fetchedAt?: string };
    if (!raw._fetchedAt || Number.isNaN(Date.parse(raw._fetchedAt))) { console.warn(`${f}: _fetchedAt fehlt – übersprungen`); continue; }
    const fetched = new Date(raw._fetchedAt);
    await withFetchLog(SNAPSHOT_PROVIDER, `splits:${sym}`, async () => {
      const r = parseSplits(raw);
      return { received: r.splits.length + r.invalid, processed: await upsertSplits(inst.id, r.splits, SNAPSHOT_PROVIDER, `Alpha Vantage SPLITS (Snapshot ${fetched.toISOString().slice(0, 10)})`, fetched) };
    });
  }
  await prisma.sourceCoverage.upsert({
    where: { provider_institution_docType: { provider: "alphavantage", institution: "US House & Senate (aggregiert)", docType: "PTR (Sekundärquelle)" } },
    create: { provider: "alphavantage", institution: "US House & Senate (aggregiert)", docType: "PTR (Sekundärquelle)", periodsChecked: "nur Ticker NVDA (Snapshot 11.10.2026)", lastSuccessAt: FETCHED_AT, docsFound: 436, docsProcessed: 436, txExtracted: 436, knownGaps: "Nur ein Ticker abgefragt; keine Vollständigkeit. Originaldokumente nicht geprüft.", lastCompletedAt: FETCHED_AT },
    update: {},
  });
  console.log("Snapshot importiert.");
}
main().finally(() => prisma.$disconnect());
