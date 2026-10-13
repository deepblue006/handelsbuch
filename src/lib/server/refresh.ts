/**
 * Aktualisierungsjobs je Provider. Jeder Job prüft Aktivierung und Zugangsdaten, respektiert
 * Limits und protokolliert über withFetchLog. Fehler eines Providers blockieren die anderen nicht.
 */
import { unzipSync, strFromU8 } from "fflate";
import { prisma } from "../db";
import { PROVIDERS, configStatus } from "../providers/registry";
import { AlphaVantageClient } from "../providers/alphavantage";
import { buildJobs, planJobs, type AvInstrument, type AvJob } from "../providers/av-plan";
import { CoinGeckoClient } from "../providers/coingecko";
import { RateLimiter, ProviderError, fetchWithRetry } from "../providers/http";
import { FRED_SERIES, fredSeries, ecbEurUsd, secTickerMap, secCompanyFacts, kalshiFedMarkets } from "../providers/official";
import { fromAlphaVantage, parseHouseIndexXml, parsePtrText } from "../politics/normalize";
import { extractPdfText } from "../politics/pdf";
import { parseRss, resolveFeedSource, MAX_FEED_BYTES } from "../social/truthsocial";
import { withFetchLog, type FetchOutcome, countCallsToday, countSuccessThisMonth, upsertBars, upsertMacro, upsertEarnings, ingestPoliticianTx, upsertEstimates, upsertInsider, upsertInstitutional, upsertSplits } from "./ingest";
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

/** Instrumente, für die Alpha Vantage abgefragt wird (ohne Demo). */
async function avInstruments() {
  return prisma.instrument.findMany({ where: { isDemo: false, OR: [{ onWatchlist: true }, { transactions: { some: {} } }, { assetType: "INDEX_PROXY" }, { inBreadthUniverse: true }, { industry: "SPDR-Sektor-ETF" }] }, include: { _count: { select: { transactions: true } } } });
}

/** Abrufplan für heute: fällige Datensätze nach Priorität, Restkontingent, Aufgeschobenes. */
export async function alphaVantagePlan(now = new Date()) {
  const dailyLimit = Number(process.env.ALPHAVANTAGE_DAILY_LIMIT ?? 25);
  const [instruments, used, last] = await Promise.all([
    avInstruments(),
    countCallsToday("alphavantage"),
    prisma.fetchLog.groupBy({ by: ["dataset"], where: { providerId: "alphavantage", status: { in: ["SUCCESS", "PARTIAL"] } }, _max: { startedAt: true } }),
  ]);
  const lastSuccess = new Map(last.filter((l) => l._max.startedAt).map((l) => [l.dataset, l._max.startedAt!]));
  const descr: AvInstrument[] = instruments.map((i) => ({
    symbol: i.symbol, assetType: i.assetType, held: i.onWatchlist || i._count.transactions > 0, isIndexProxy: i.assetType === "INDEX_PROXY",
    isSectorEtf: i.industry === "SPDR-Sektor-ETF", inBreadthUniverse: i.inBreadthUniverse,
    splitsManual: (i.splitsCheckedSource ?? "").startsWith("manuell"), splitsCheckedAt: i.splitsCheckedAt, hasCoinGecko: !!process.env.COINGECKO_API_KEY && !!(i.providerIds as Record<string, string>).coingecko,
  }));
  const jobs = buildJobs(descr, now);
  return { plan: planJobs(jobs, lastSuccess, now, dailyLimit - used), used, dailyLimit, instruments, totalJobs: jobs.length };
}

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
  const { plan, instruments } = await alphaVantagePlan();
  const bySymbol = new Map(instruments.map((i) => [i.symbol, i]));
  const fromDate = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const macroJobs: Record<string, () => ReturnType<AlphaVantageClient["treasury10y"]>> = {
    US10Y: () => client.treasury10y(), EFFR: () => client.fedFunds(), EURUSD: () => client.eurusd(),
    WTI: () => client.wti(), BRENT: () => client.brent(), GOLD_USD: () => client.gold(),
  };
  const execute = (job: AvJob): (() => Promise<FetchOutcome>) => {
    const inst = job.symbol ? bySymbol.get(job.symbol)! : null;
    const sym = inst ? (inst.providerIds as Record<string, string>).alphavantage ?? inst.symbol : "";
    switch (job.kind) {
      case "daily": return async () => { const s = await client.dailyCompact(sym, inst!.currency, today); return { received: s.bars.length, processed: await upsertBars(inst!.id, s, "alphavantage", fetchedAt()) }; };
      case "weekly": return async () => { const s = await client.weekly(sym, inst!.currency, today); return { received: s.bars.length, processed: await upsertBars(inst!.id, s, "alphavantage", fetchedAt(), { skipPartial: true }) }; };
      case "macro": {
        const k = job.dataset.slice("macro:".length);
        return async () => { const d = await macroJobs[k]!(); const m = MACRO_META[k]!; return { received: d.points.length, processed: await upsertMacro({ key: k, ...m, provider: "alphavantage" }, d, fetchedAt()) }; };
      }
      // Krypto: UTC-Tageskerzen → laufenden Tag nach UTC-Datum erkennen
      case "crypto": return async () => { const s = await client.cryptoDaily(inst!.symbol, inst!.currency, todayIso("UTC")); return { received: s.bars.length, processed: await upsertBars(inst!.id, s, "alphavantage", fetchedAt(), { skipPartial: true }) }; };
      case "earnings": return async () => { const e = await client.earnings(inst!.symbol); return { received: e.length, processed: await upsertEarnings(inst!.id, e, "alphavantage", fetchedAt()) }; };
      case "estimates": return async () => { const e = await client.estimates(inst!.symbol); return { received: e.length, processed: await upsertEstimates(inst!.id, e, "alphavantage", fetchedAt()) }; };
      case "insider": return async () => { const t = await client.insider(inst!.symbol, fromDate); return { received: t.length, processed: await upsertInsider(inst!.id, t, "alphavantage", fetchedAt()), note: "Alpha Vantage liefert kein Meldedatum (Form 4: i. d. R. binnen 2 Geschäftstagen)" }; };
      case "institutional": return async () => { const r = await client.institutional(inst!.symbol); return { received: r.holdings.length, processed: await upsertInstitutional(inst!.symbol, r, "alphavantage", fetchedAt()), note: r.mixedPeriods ? `Gemischte Meldestichtage: ${r.reportPeriods.join(", ")}` : undefined }; };
      case "congress": return async () => {
        const r = await client.congressTrades(inst!.symbol);
        const c = await ingestPoliticianTx(r.trades.map(fromAlphaVantage), fetchedAt(), today);
        return { received: r.trades.length + r.invalid, processed: c.INSERT + c.SUPERSEDE + c.DELETE_MARK + c.REVIEW + c.DUPLICATE };
      };
      case "splits": return async () => { const r = await client.splits(sym); return { received: r.splits.length + r.invalid, processed: await upsertSplits(inst!.id, r.splits, "alphavantage", `Alpha Vantage SPLITS (${today})`, fetchedAt()), note: r.invalid ? `${r.invalid} ungültige Einträge verworfen` : undefined }; };
    }
  };
  for (const job of plan.run) {
    const r = await withFetchLog("alphavantage", job.dataset, execute(job), 24 * 60);
    out.push({ provider: "alphavantage", dataset: job.dataset, ok: r.ok, info: r.ok ? `${r.processed} Datensätze` : r.error });
    if (!r.ok && r.kind === "RATE_LIMIT") break; // Anbieter meldet Limit → Rest nicht mehr versuchen
  }
  if (plan.deferred.length) {
    // Ein Protokolleintrag statt vieler Fehlschläge; SKIPPED zählt nicht als Abruf
    await withFetchLog("alphavantage", "kontingent", async () => ({ received: plan.deferred.length, processed: 0, status: "SKIPPED", note: `${plan.deferred.length} fällige Abrufe auf morgen verschoben (Tageskontingent): ${plan.deferred.map((j) => j.dataset).join(", ")}` }));
    out.push({ provider: "alphavantage", dataset: "kontingent", ok: true, info: `${plan.deferred.length} Abrufe aufgeschoben` });
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

/** Speichert eine Provider-Momentaufnahme (JSON) unter einem Datenschlüssel – keine Konfiguration. */
async function storeSnapshot(key: string, value: unknown) {
  const v = JSON.parse(JSON.stringify(value)) as object;
  await prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

export async function refreshCoinGecko(): Promise<JobResult[]> {
  if (!(await isEnabled("coingecko"))) return [];
  const out: JobResult[] = [];
  const today = todayIso("UTC"); // Krypto-Tageskerzen schließen um 00:00 UTC – nicht Berliner Datum verwenden
  const monthlyLimit = Number(process.env.COINGECKO_MONTHLY_CREDITS ?? 10_000);
  let client: CoinGeckoClient;
  try {
    // 2,1 s Abstand ≈ 28/min: unter dem konservativsten genannten Demo-Limit (30/min)
    client = new CoinGeckoClient(process.env.COINGECKO_API_KEY ?? "", new RateLimiter(2100), async () => ({ used: await countSuccessThisMonth("coingecko"), limit: monthlyLimit }));
  } catch (e) {
    await withFetchLog("coingecko", "konfiguration", async () => { throw e; });
    return [{ provider: "coingecko", dataset: "konfiguration", ok: false, info: "COINGECKO_API_KEY fehlt" }];
  }
  const cryptos = (await prisma.instrument.findMany({ where: { assetType: "CRYPTO", isDemo: false } })).filter((c) => (c.providerIds as Record<string, string>).coingecko);
  const push = (dataset: string, r: Awaited<ReturnType<typeof withFetchLog>>) => out.push({ provider: "coingecko", dataset, ok: r.ok, info: r.ok ? `${r.processed} Datensätze` : r.error });

  // 1) Kurs + Marktdaten: eine Anfrage je Handelswährung für alle Coins
  const byCur = new Map<string, typeof cryptos>();
  for (const c of cryptos) byCur.set(c.currency, [...(byCur.get(c.currency) ?? []), c]);
  for (const [cur, list] of byCur) {
    const ds = `markets:${cur}`;
    push(ds, await withFetchLog("coingecko", ds, async () => {
      const idOf = (c: (typeof list)[number]) => (c.providerIds as Record<string, string>).coingecko!;
      const r = await client.markets(list.map(idOf), cur);
      const fetchedAt = new Date();
      let processed = 0;
      for (const c of list) {
        const m = r.coins.find((x) => x.id === idOf(c));
        if (!m) continue;
        if (m.price != null) await prisma.quote.create({ data: { instrumentId: c.id, last: m.price, quoteTime: m.lastUpdated ? new Date(m.lastUpdated) : null, venue: "CoinGecko-Aggregat", currency: cur, provider: "coingecko", fetchedAt } });
        await storeSnapshot(`cg:market:${c.symbol}`, { ...m, currency: cur, fetchedAt: fetchedAt.toISOString(), missingFields: r.missingFields });
        processed++;
      }
      const notFound = list.filter((c) => !r.coins.some((x) => x.id === idOf(c))).map((c) => `${c.symbol} (${idOf(c)})`);
      const notes = [notFound.length ? `nicht gefunden: ${notFound.join(", ")}` : "", r.missingFields.length ? `fehlende Felder: ${r.missingFields.join(", ")}` : "", r.invalid ? `${r.invalid} ungültige Zeilen` : ""].filter(Boolean);
      return { received: r.coins.length + r.invalid, processed, note: notes.length ? notes.join("; ") : undefined };
    }));
  }

  // 2) Tageskurse (365 Tage, Demo-Grenze); laufender UTC-Tag wird verworfen
  for (const c of cryptos) {
    const ds = `chart:${c.symbol}`;
    if (await fetchedToday("coingecko", ds)) continue;
    push(ds, await withFetchLog("coingecko", ds, async () => {
      const d = await client.chart((c.providerIds as Record<string, string>).coingecko!, c.currency, today);
      const bars = d.partialLast ? d.bars.slice(0, -1) : d.bars;
      return { received: d.bars.length, processed: await upsertBars(c.id, { symbol: c.symbol, currency: c.currency, interval: "DAY", adjusted: false, lastRefreshed: null, timeZone: "UTC", bars, partialLastBar: false }, "coingecko", new Date()), note: d.partialLast ? "laufender UTC-Tag verworfen" : undefined };
    }));
  }

  // 3) Gesamtmarkt (BTC-Dominanz, Marktkapitalisierung); Anbieter aktualisiert alle 10 Minuten
  push("global", await withFetchLog("coingecko", "global", async () => {
    const g = await client.global();
    await storeSnapshot("cg:global", { ...g, fetchedAt: new Date().toISOString() });
    return { received: 1, processed: 1 };
  }));
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
      create: { provider: "house_clerk", institution: "US House Clerk", docType: "PTR", periodsChecked: String(year), lastSuccessAt: new Date(), docsFound: ptr.length, docsProcessed: processed, docsPending: ptr.length - processed, knownGaps: "PTR-PDFs werden per Textextraktion ausgewertet; gescannte/handschriftliche PDFs und nicht eindeutige Zeilen landen in der Prüfwarteschlange.", lastCompletedAt: new Date() },
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
  const out = [{ provider: "house_clerk", dataset: ds, ok: r.ok, info: r.ok ? `${r.processed} PTR-Dokumente` : r.error }];
  if (r.ok) out.push(...(await processHousePdfs(year)));
  return out;
}

/** Lädt bis zu HOUSE_PDF_PER_RUN offene PTR-PDFs (1 je Sekunde), extrahiert Text und legt Transaktionen zur Prüfung an. */
export async function processHousePdfs(year: number): Promise<JobResult[]> {
  const limit = Number(process.env.HOUSE_PDF_PER_RUN ?? 20);
  const limiter = new RateLimiter(1000);
  const filings = await prisma.politicianFiling.findMany({ where: { source: "HOUSE_CLERK", year, filingType: "PTR", status: "OFFIZIELLE_QUELLE_GEFUNDEN", transactions: { none: {} } }, orderBy: { filedDate: "desc" }, take: limit });
  const out: JobResult[] = [];
  for (const f of filings) {
    if (!f.sourceUrl) continue;
    await limiter.acquire();
    const r = await withFetchLog("house_clerk", `pdf:${f.docId}`, async () => {
      const res = await fetchWithRetry(f.sourceUrl!, { retries: 1, timeoutMs: 60_000 });
      const pdf = await extractPdfText(new Uint8Array(await res.arrayBuffer()));
      if (!pdf.hasTextLayer) {
        await prisma.politicianFiling.update({ where: { id: f.id }, data: { status: "UNVOLLSTAENDIG", lastError: pdf.note } });
        return { received: 0, processed: 0, status: "PARTIAL" as const, note: pdf.note };
      }
      const rows = parsePtrText(pdf.text, { politicianName: f.filerName, chamber: "HOUSE", filedDate: f.filedDate?.toISOString().slice(0, 10) ?? null, state: f.stateDistrict });
      const c = await ingestPoliticianTx(rows, new Date(), todayIso(), f.id);
      await prisma.politicianFiling.update({ where: { id: f.id }, data: { rawText: pdf.text.slice(0, 100_000), status: rows.length ? "AUTOMATISCH_EXTRAHIERT" : "NICHT_EINDEUTIG", lastError: rows.length ? null : "Keine Transaktionszeilen erkannt – manuelle Erfassung nötig" } });
      return { received: rows.length, processed: c.INSERT + c.REVIEW + c.SUPERSEDE, note: pdf.note };
    });
    out.push({ provider: "house_clerk", dataset: `pdf:${f.docId}`, ok: r.ok, info: r.ok ? `${r.processed} Transaktionen` : r.error });
  }
  return out;
}

export async function truthFeedSource() {
  const st = await prisma.setting.findUnique({ where: { key: "truthFeedPreset" } });
  return resolveFeedSource(process.env.TRUTHSOCIAL_FEED_URL, !!(st?.value as { active?: boolean } | null)?.active);
}

export async function refreshTruthSocial(): Promise<JobResult[]> {
  if (!(await isEnabled("truthsocial"))) return [];
  const src = await truthFeedSource();
  const r = await withFetchLog("truthsocial", "feed", async () => {
    if (!src) throw new ProviderError("Keine Feed-Quelle aktiv (Archiv-Voreinstellung aktivieren oder TRUTHSOCIAL_FEED_URL setzen)", "ZUGANG_FEHLT");
    const res = await fetchWithRetry(src.url, { retries: 1, headers: { Accept: "application/rss+xml, application/xml;q=0.9" } });
    const xml = await res.text();
    if (xml.length > MAX_FEED_BYTES) throw new ProviderError(`Feed zu groß (${xml.length} Bytes)`, "FORMAT");
    const posts = await parseRss(xml);
    const now = new Date();
    let created = 0;
    for (const p of posts) {
      const existing = await prisma.socialPost.findUnique({ where: { platform_postId: { platform: "TRUTH_SOCIAL", postId: p.id } }, select: { id: true } });
      // Text wird nur beim ersten Abruf gespeichert (spätere Ergänzungen der Quelle ändern ihn nicht)
      await prisma.socialPost.upsert({
        where: { platform_postId: { platform: "TRUTH_SOCIAL", postId: p.id } },
        create: { platform: "TRUTH_SOCIAL", account: "realDonaldTrump", postId: p.id, createdAt: new Date(p.createdAt), text: p.text, url: p.url, sourceUrl: p.sourceUrl, provider: src.label, fetchedAt: now, hasMedia: p.hasMedia, isRepost: p.isRepost },
        update: { fetchedAt: now },
      });
      if (!existing) created++;
    }
    return { received: posts.length, processed: posts.length, note: `${created} neu · Quelle: ${src.label}` };
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
