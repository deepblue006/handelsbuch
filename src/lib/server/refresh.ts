/**
 * Aktualisierungsjobs je Provider. Jeder Job prüft Aktivierung und Zugangsdaten, respektiert
 * Limits und protokolliert über withFetchLog. Fehler eines Providers blockieren die anderen nicht.
 */
import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "../db";
import { PROVIDERS, configStatus } from "../providers/registry";
import { AlphaVantageClient } from "../providers/alphavantage";
import { RateLimiter, ProviderError, fetchWithRetry } from "../providers/http";
import { FRED_SERIES, fredSeries, ecbEurUsd, coingeckoChart, secTickerMap, secCompanyFacts, kalshiFedMarkets } from "../providers/official";
import { fromAlphaVantage, parseHouseIndexXml } from "../politics/normalize";
import { parseRss } from "../social/truthsocial";
import { withFetchLog, countCallsToday, upsertBars, upsertMacro, upsertEarnings, ingestPoliticianTx, upsertEstimates, upsertInsider, upsertInstitutional } from "./ingest";
import { todayIso } from "../settings";

export async function isEnabled(providerId: string): Promise<boolean> {
  const info = PROVIDERS.find((p) => p.id === providerId);
  if (!info) return false;
  const st = await prisma.providerState.findUnique({ where: { providerId } });
  return st ? st.enabled : info.defaultEnabled;
}

async function fetchedToday(providerId: string, dataset: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return (await prisma.fetchLog.count({ where: { providerId, dataset, status: "SUCCESS", startedAt: { gte: start } } })) > 0;
}

type JobResult = { provider: string; dataset: string; ok: boolean; info: string };

const MACRO_META: Record<string, { name: string; unit: string; frequency: string; originalSource: string }> = {
  US10Y: { name: "Rendite 10-jähriger US-Staatsanleihen", unit: "%", frequency: "daily", originalSource: "Federal Reserve H.15 (über Alpha Vantage)" },
  EFFR: { name: "Effective Federal Funds Rate", unit: "%", frequency: "daily", originalSource: "Federal Reserve H.15 (über Alpha Vantage)" },
  WTI: { name: "WTI Rohöl", unit: "USD je Barrel", frequency: "daily", originalSource: "U.S. EIA (über Alpha Vantage)" },
  BRENT: { name: "Brent Rohöl", unit: "USD je Barrel", frequency: "daily", originalSource: "U.S. EIA (über Alpha Vantage)" },
  GOLD_USD: { name: "Gold (XAU/USD)", unit: "USD je Feinunze", frequency: "daily", originalSource: "Alpha Vantage" },
  EURUSD: { name: "EUR/USD Tagesschluss", unit: "USD je EUR", frequency: "daily", originalSource: "Alpha Vantage FX_DAILY" },
};

export async function refreshAlphaVantage(): Promise<JobResult[]> {
  const out: JobResult[] = [];
  if (!(await isEnabled("alphavantage"))) return out;
  const key = process.env.ALPHAVANTAGE_API_KEY ?? "";
  const dailyLimit = Number(process.env.ALPHAVANTAGE_DAILY_LIMIT ?? 25);
  const limiter = new RateLimiter(1200, dailyLimit, () => countCallsToday("alphavantage"));
  let client: AlphaVantageClient;
  try {
    client = new AlphaVantageClient(key, limiter);
  } catch (e) {
    await withFetchLog("alphavantage", "konfiguration", async () => { throw e; });
    return [{ provider: "alphavantage", dataset: "konfiguration", ok: false, info: "ALPHAVANTAGE_API_KEY fehlt" }];
  }
  const today = todayIso();
  const fetchedAt = () => new Date();
  const run = async (dataset: string, fn: () => Promise<{ received: number; processed: number }>) => {
    if (await fetchedToday("alphavantage", dataset)) return;
    const r = await withFetchLog("alphavantage", dataset, fn, 24 * 60);
    out.push({ provider: "alphavantage", dataset, ok: r.ok, info: r.ok ? `${r.processed} Datensätze` : r.error });
  };
  // Reihenfolge = Priorität bei knappem Tageskontingent
  const macroJobs: [string, () => ReturnType<AlphaVantageClient["treasury10y"]>][] = [
    ["US10Y", () => client.treasury10y()], ["EFFR", () => client.fedFunds()], ["EURUSD", () => client.eurusd()],
    ["WTI", () => client.wti()], ["BRENT", () => client.brent()], ["GOLD_USD", () => client.gold()],
  ];
  const instruments = await prisma.instrument.findMany({ where: { isDemo: false, OR: [{ onWatchlist: true }, { transactions: { some: {} } }, { assetType: "INDEX_PROXY" }, { inBreadthUniverse: true }] } });
  for (const inst of instruments.filter((i) => i.assetType !== "CRYPTO")) {
    const sym = (inst.providerIds as Record<string, string>).alphavantage ?? inst.symbol;
    await run(`daily:${inst.symbol}`, async () => { const s = await client.dailyCompact(sym, inst.currency, today); return { received: s.bars.length, processed: await upsertBars(inst.id, s, "alphavantage", fetchedAt()) }; });
    await run(`weekly:${inst.symbol}`, async () => { const s = await client.weekly(sym, inst.currency, today); return { received: s.bars.length, processed: await upsertBars(inst.id, s, "alphavantage", fetchedAt(), { skipPartial: true }) }; });
  }
  for (const [k, fn] of macroJobs) {
    await run(`macro:${k}`, async () => {
      const d = await fn();
      const m = MACRO_META[k]!;
      return { received: d.points.length, processed: await upsertMacro({ key: k, ...m, provider: "alphavantage" }, d, fetchedAt()) };
    });
  }
  for (const inst of instruments.filter((i) => i.assetType === "STOCK")) {
    await run(`earnings:${inst.symbol}`, async () => { const e = await client.earnings(inst.symbol); return { received: e.length, processed: await upsertEarnings(inst.id, e, "alphavantage", fetchedAt()) }; });
  }
  for (const inst of instruments.filter((i) => i.assetType === "STOCK")) {
    await run(`estimates:${inst.symbol}`, async () => { const e = await client.estimates(inst.symbol); return { received: e.length, processed: await upsertEstimates(inst.id, e, "alphavantage", fetchedAt()) }; });
  }
  for (const inst of instruments.filter((i) => i.assetType === "CRYPTO" && !process.env.COINGECKO_API_KEY)) {
    await run(`crypto:${inst.symbol}`, async () => { const s = await client.cryptoDaily(inst.symbol, inst.currency, today); return { received: s.bars.length, processed: await upsertBars(inst.id, s, "alphavantage", fetchedAt(), { skipPartial: true }) }; });
  }
  const fromDate = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  for (const inst of instruments.filter((i) => i.assetType === "STOCK")) {
    await run(`insider:${inst.symbol}`, async () => { const t = await client.insider(inst.symbol, fromDate); return { received: t.length, processed: await upsertInsider(inst.id, t, "alphavantage", fetchedAt()), note: "Alpha Vantage liefert kein Meldedatum (Form 4: i. d. R. binnen 2 Geschäftstagen)" }; });
    await run(`institutional:${inst.symbol}`, async () => { const r = await client.institutional(inst.symbol); return { received: r.holdings.length, processed: await upsertInstitutional(inst.symbol, r, "alphavantage", fetchedAt()), note: r.mixedPeriods ? `Gemischte Meldestichtage: ${r.reportPeriods.join(", ")}` : undefined }; });
  }
  const held = instruments.filter((i) => i.assetType === "STOCK");
  for (const inst of held) {
    await run(`congress:${inst.symbol}`, async () => {
      const r = await client.congressTrades(inst.symbol);
      const c = await ingestPoliticianTx(r.trades.map(fromAlphaVantage), fetchedAt(), today);
      return { received: r.trades.length + r.invalid, processed: c.INSERT + c.SUPERSEDE + c.DELETE_MARK + c.REVIEW + c.DUPLICATE };
    });
  }
  return out;
}

export async function refreshFred(): Promise<JobResult[]> {
  if (!(await isEnabled("fred"))) return [];
  const out: JobResult[] = [];
  const key = process.env.FRED_API_KEY ?? "";
  for (const k of Object.keys(FRED_SERIES)) {
    const ds = `fred:${k}`;
    if (await fetchedToday("fred", ds)) continue;
    const r = await withFetchLog("fred", ds, async () => {
      const d = await fredSeries(k, key, "2000-01-01");
      const m = FRED_SERIES[k]!;
      return { received: d.points.length, processed: await upsertMacro({ key: `FRED_${k}`, name: m.name, unit: m.unit, provider: "fred", originalSource: m.originalSource, sourceUrl: `https://fred.stlouisfed.org/series/${m.id}`, frequency: m.frequency }, d, new Date()) };
    });
    out.push({ provider: "fred", dataset: ds, ok: r.ok, info: r.ok ? `${r.processed}` : r.error });
    if (!r.ok && r.kind === "ZUGANG_FEHLT") break;
  }
  return out;
}

export async function refreshEcb(): Promise<JobResult[]> {
  if (!(await isEnabled("ecb")) || (await fetchedToday("ecb", "EURUSD"))) return [];
  const r = await withFetchLog("ecb", "EURUSD", async () => {
    const d = await ecbEurUsd("2015-01-01");
    return { received: d.points.length, processed: await upsertMacro({ key: "ECB_EURUSD", name: d.name, unit: d.unit, provider: "ecb", originalSource: "Europäische Zentralbank", sourceUrl: "https://data.ecb.europa.eu/data/datasets/EXR/EXR.D.USD.EUR.SP00.A", frequency: "daily" }, d, new Date()) };
  });
  return [{ provider: "ecb", dataset: "EURUSD", ok: r.ok, info: r.ok ? `${r.processed}` : r.error }];
}

export async function refreshCoinGecko(): Promise<JobResult[]> {
  if (!(await isEnabled("coingecko"))) return [];
  const out: JobResult[] = [];
  const key = process.env.COINGECKO_API_KEY ?? "";
  const today = todayIso();
  const cryptos = await prisma.instrument.findMany({ where: { assetType: "CRYPTO", isDemo: false } });
  for (const c of cryptos) {
    const id = (c.providerIds as Record<string, string>).coingecko;
    const ds = `chart:${c.symbol}`;
    if (!id || (await fetchedToday("coingecko", ds))) continue;
    const r = await withFetchLog("coingecko", ds, async () => {
      const d = await coingeckoChart(id, c.currency, key, today);
      const bars = d.partialLast ? d.bars.slice(0, -1) : d.bars;
      return { received: d.bars.length, processed: await upsertBars(c.id, { symbol: c.symbol, currency: c.currency, interval: "DAY", adjusted: false, lastRefreshed: null, timeZone: "UTC", bars, partialLastBar: false }, "coingecko", new Date()) };
    });
    out.push({ provider: "coingecko", dataset: ds, ok: r.ok, info: r.ok ? `${r.processed}` : r.error });
  }
  return out;
}

export async function refreshSec(): Promise<JobResult[]> {
  if (!(await isEnabled("sec"))) return [];
  const ua = process.env.SEC_USER_AGENT;
  const out: JobResult[] = [];
  const stocks = await prisma.instrument.findMany({ where: { assetType: "STOCK", isDemo: false, OR: [{ country: null }, { country: "US" }] } });
  if (!stocks.length) return out;
  let map: Map<string, { cik: string; title: string }> | null = null;
  const tm = await withFetchLog("sec", "company_tickers", async () => { map = await secTickerMap(ua); return { received: map.size, processed: map.size }; });
  if (!tm.ok || !map) return [{ provider: "sec", dataset: "company_tickers", ok: false, info: tm.ok ? "" : tm.error }];
  for (const s of stocks) {
    const hit = (map as Map<string, { cik: string }>).get(s.symbol.toUpperCase());
    const ds = `facts:${s.symbol}`;
    if (!hit || (await fetchedToday("sec", ds))) continue;
    const r = await withFetchLog("sec", ds, async () => {
      const f = await secCompanyFacts(hit.cik, ua);
      const now = new Date();
      for (const x of f.facts) {
        await prisma.fundamental.upsert({
          where: { instrumentId_metric_periodEnd_periodType_provider: { instrumentId: s.id, metric: x.metric, periodEnd: new Date(x.periodEnd + "T00:00:00Z"), periodType: x.periodType, provider: "sec" } },
          create: { instrumentId: s.id, metric: x.metric, periodEnd: new Date(x.periodEnd + "T00:00:00Z"), periodType: x.periodType, fiscalYear: x.fiscalYear, value: x.value, unit: x.unit, filedAt: new Date(x.filedAt + "T00:00:00Z"), provider: "sec", sourceRef: x.accession, fetchedAt: now },
          update: { fetchedAt: now },
        });
      }
      return { received: f.facts.length, processed: f.facts.length, note: f.restatements ? `${f.restatements} spätere Korrekturen erkannt (erste Fassung behalten)` : undefined };
    });
    out.push({ provider: "sec", dataset: ds, ok: r.ok, info: r.ok ? `${r.processed}` : r.error });
  }
  return out;
}

export async function refreshKalshi(): Promise<JobResult[]> {
  if (!(await isEnabled("kalshi")) || (await fetchedToday("kalshi", "KXFED"))) return [];
  const r = await withFetchLog("kalshi", "KXFED", async () => {
    const m = await kalshiFedMarkets();
    await prisma.setting.upsert({ where: { key: "kalshiSnapshot" }, create: { key: "kalshiSnapshot", value: { fetchedAt: new Date().toISOString(), markets: m } }, update: { value: { fetchedAt: new Date().toISOString(), markets: m } } });
    return { received: m.length, processed: m.length };
  });
  return [{ provider: "kalshi", dataset: "KXFED", ok: r.ok, info: r.ok ? `${r.processed}` : r.error }];
}

/** Offizieller Jahresindex des House Clerk: erfasst PTR-Dokumente (ohne automatische PDF-Extraktion). */
export async function refreshHouseClerk(year = Number(todayIso().slice(0, 4))): Promise<JobResult[]> {
  if (!(await isEnabled("house_clerk"))) return [];
  const ds = `index:${year}`;
  if (await fetchedToday("house_clerk", ds)) return [];
  const r = await withFetchLog("house_clerk", ds, async () => {
    const res = await fetchWithRetry(`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`, { timeoutMs: 60_000 });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 50 * 1024 * 1024) throw new ProviderError("ZIP-Archiv unerwartet groß (> 50 MB) – abgebrochen", "FORMAT");
    const files = unzipSync(buf, { filter: (f) => /FD\.xml$/i.test(f.name) && f.originalSize < 100 * 1024 * 1024 });
    const xmlName = Object.keys(files)[0];
    if (!xmlName) throw new ProviderError("Keine Indexdatei im Archiv", "FORMAT");
    const entries = await parseHouseIndexXml(strFromU8(files[xmlName]!));
    const ptr = entries.filter((e) => e.filingType === "PTR" || e.filingType === "AMENDMENT");
    for (const e of ptr) {
      await prisma.politicianFiling.upsert({
        where: { source_docId_version: { source: "HOUSE_CLERK", docId: e.docId, version: 1 } },
        create: { source: "HOUSE_CLERK", chamber: "HOUSE", docId: e.docId, filerName: e.filerName, filingType: e.filingType, stateDistrict: e.stateDistrict, year: e.year, filedDate: e.filedDate ? new Date(e.filedDate + "T00:00:00Z") : null, sourceUrl: e.pdfUrl, status: "OFFIZIELLE_QUELLE_GEFUNDEN" },
        update: {},
      });
    }
    const processed = await prisma.politicianFiling.count({ where: { source: "HOUSE_CLERK", year, transactions: { some: {} } } });
    await prisma.sourceCoverage.upsert({
      where: { provider_institution_docType: { provider: "house_clerk", institution: "US House Clerk", docType: "PTR" } },
      create: { provider: "house_clerk", institution: "US House Clerk", docType: "PTR", periodsChecked: String(year), lastSuccessAt: new Date(), docsFound: ptr.length, docsProcessed: processed, docsPending: ptr.length - processed, knownGaps: "PDF-Transaktionen werden nicht automatisch extrahiert; Texteinfügen in der Prüfwarteschlange.", lastCompletedAt: new Date() },
      update: { periodsChecked: String(year), lastSuccessAt: new Date(), docsFound: ptr.length, docsProcessed: processed, docsPending: ptr.length - processed, lastCompletedAt: new Date() },
    });
    return { received: entries.length, processed: ptr.length };
  });
  if (!r.ok) {
    await prisma.sourceCoverage.upsert({
      where: { provider_institution_docType: { provider: "house_clerk", institution: "US House Clerk", docType: "PTR" } },
      create: { provider: "house_clerk", institution: "US House Clerk", docType: "PTR", lastError: r.error, lastErrorAt: new Date() },
      update: { lastError: r.error, lastErrorAt: new Date() },
    });
  }
  return [{ provider: "house_clerk", dataset: ds, ok: r.ok, info: r.ok ? `${r.processed} PTR-Dokumente` : r.error }];
}

export async function refreshTruthSocial(): Promise<JobResult[]> {
  if (!(await isEnabled("truthsocial"))) return [];
  const url = process.env.TRUTHSOCIAL_FEED_URL;
  const r = await withFetchLog("truthsocial", "feed", async () => {
    if (!url) throw new ProviderError("Keine zulässige Feed-Quelle konfiguriert (TRUTHSOCIAL_FEED_URL)", "ZUGANG_FEHLT");
    const res = await fetchWithRetry(url, { retries: 1 });
    const posts = await parseRss(await res.text());
    const now = new Date();
    for (const p of posts) {
      await prisma.socialPost.upsert({ where: { platform_postId: { platform: "TRUTH_SOCIAL", postId: p.id } }, create: { platform: "TRUTH_SOCIAL", account: "realDonaldTrump", postId: p.id, createdAt: new Date(p.createdAt), text: p.text, url: p.url, provider: "rss", fetchedAt: now, hasMedia: p.hasMedia }, update: { fetchedAt: now } });
    }
    return { received: posts.length, processed: posts.length };
  });
  return [{ provider: "truthsocial", dataset: "feed", ok: r.ok, info: r.ok ? `${r.processed} Posts` : r.error }];
}

export async function refreshAll(): Promise<JobResult[]> {
  const jobs = [refreshAlphaVantage, refreshFred, refreshEcb, refreshCoinGecko, refreshSec, refreshKalshi, refreshHouseClerk, refreshTruthSocial];
  const results: JobResult[] = [];
  for (const j of jobs) {
    try {
      results.push(...(await j()));
    } catch (e) {
      results.push({ provider: j.name, dataset: "job", ok: false, info: String((e as Error).message) });
    }
  }
  return results;
}

export { configStatus };
