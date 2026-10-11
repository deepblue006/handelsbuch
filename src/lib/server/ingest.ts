/**
 * Schreibt Provider-Ergebnisse in die Datenbank und protokolliert jeden Abruf (FetchLog, ProviderState).
 */
import type { AssetType, BarInterval, FetchStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { redact } from "../security/redact";
import { ProviderError } from "../providers/http";
import type { BarSeries, EarningsData, MacroSeriesData } from "../providers/types";
import { assignOccurrences, checkPlausibility, correctionKey, dedupeKey, orderForIngest, reconcile, statusFor, type NormTx, type StoredTx } from "../politics/normalize";
import type { FlowRow } from "../flows/flows";

export interface FetchOutcome {
  received: number;
  processed: number;
  status?: FetchStatus;
  note?: string;
}

/** Führt einen Abruf aus und protokolliert Beginn, Ende, Status, Datensätze und bereinigte Fehler. */
export async function withFetchLog(providerId: string, dataset: string, fn: () => Promise<FetchOutcome>, retryAfterMinutes = 60) {
  const startedAt = new Date();
  try {
    const r = await fn();
    const status = r.status ?? (r.processed < r.received ? "PARTIAL" : "SUCCESS");
    await prisma.fetchLog.create({ data: { providerId, dataset, startedAt, finishedAt: new Date(), status, recordsReceived: r.received, recordsProcessed: r.processed, errorMessage: r.note ? redact(r.note) : null } });
    await prisma.providerState.upsert({ where: { providerId }, create: { providerId, lastSuccessAt: new Date() }, update: { lastSuccessAt: new Date() } });
    return { ok: true as const, ...r, status };
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null;
    const msg = redact(e);
    const skipped = pe?.kind === "ZUGANG_FEHLT" || pe?.kind === "DEAKTIVIERT";
    const next = pe?.retryable || pe?.kind === "NETZWERK" ? new Date(Date.now() + retryAfterMinutes * 60_000) : null;
    await prisma.fetchLog.create({ data: { providerId, dataset, startedAt, finishedAt: new Date(), status: skipped ? "SKIPPED" : "FAILED", httpStatus: pe?.httpStatus ?? null, errorMessage: msg, nextAttemptAt: next } });
    if (!skipped) await prisma.providerState.upsert({ where: { providerId }, create: { providerId, lastErrorAt: new Date(), lastError: msg }, update: { lastErrorAt: new Date(), lastError: msg } });
    return { ok: false as const, error: msg, kind: pe?.kind ?? "UNBEKANNT" };
  }
}

/** Anzahl erfolgreicher/fehlgeschlagener Abrufe eines Providers seit Mitternacht UTC (für Tageskontingente). */
export async function countCallsToday(providerId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return prisma.fetchLog.count({ where: { providerId, startedAt: { gte: start }, status: { in: ["SUCCESS", "PARTIAL", "FAILED"] } } });
}

export async function ensureInstrument(data: { symbol: string; name: string; assetType: AssetType; currency: string; exchange?: string | null; providerIds?: Record<string, string>; isDemo?: boolean; inBreadthUniverse?: boolean; onWatchlist?: boolean; sector?: string | null }) {
  const existing = await prisma.instrument.findUnique({ where: { symbol: data.symbol } });
  if (existing) return existing;
  return prisma.instrument.create({
    data: {
      symbol: data.symbol, name: data.name, assetType: data.assetType, currency: data.currency, exchange: data.exchange ?? null,
      providerIds: data.providerIds ?? {}, isDemo: data.isDemo ?? false, inBreadthUniverse: data.inBreadthUniverse ?? false, onWatchlist: data.onWatchlist ?? false, sector: data.sector ?? null,
    },
  });
}

export async function upsertBars(instrumentId: string, s: BarSeries, provider: string, fetchedAt: Date, opts: { isDemo?: boolean; skipPartial?: boolean } = {}) {
  const bars = opts.skipPartial && s.partialLastBar ? s.bars.slice(0, -1) : s.bars;
  const interval: BarInterval = s.interval;
  let n = 0;
  for (let i = 0; i < bars.length; i += 500) {
    const chunk = bars.slice(i, i + 500);
    await prisma.$transaction(chunk.map((b) => prisma.priceBar.upsert({
      where: { instrumentId_interval_date_provider: { instrumentId, interval, date: new Date(b.date + "T00:00:00Z"), provider } },
      create: { instrumentId, interval, date: new Date(b.date + "T00:00:00Z"), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, currency: s.currency, adjusted: s.adjusted, provider, fetchedAt, isDemo: opts.isDemo ?? false },
      update: { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, fetchedAt },
    })));
    n += chunk.length;
  }
  return n;
}

export async function upsertMacro(meta: { key: string; name: string; unit: string; provider: string; originalSource?: string | null; sourceUrl?: string | null; frequency: string }, data: MacroSeriesData, fetchedAt: Date, sinceIso?: string) {
  await prisma.macroSeries.upsert({
    where: { key: meta.key },
    create: { key: meta.key, name: meta.name, unit: meta.unit, provider: meta.provider, originalSource: meta.originalSource ?? null, sourceUrl: meta.sourceUrl ?? null, frequency: meta.frequency },
    update: { name: meta.name, unit: meta.unit, provider: meta.provider, originalSource: meta.originalSource ?? null, sourceUrl: meta.sourceUrl ?? null, frequency: meta.frequency },
  });
  const pts = sinceIso ? data.points.filter((p) => p.date >= sinceIso) : data.points;
  for (let i = 0; i < pts.length; i += 1000) {
    const chunk = pts.slice(i, i + 1000);
    await prisma.$transaction(chunk.map((p) => prisma.macroObservation.upsert({
      where: { seriesKey_date_provider: { seriesKey: meta.key, date: new Date(p.date + "T00:00:00Z"), provider: meta.provider } },
      create: { seriesKey: meta.key, date: new Date(p.date + "T00:00:00Z"), value: p.value, fetchedAt, provider: meta.provider },
      update: { value: p.value, fetchedAt },
    })));
  }
  return pts.length;
}

export async function upsertEarnings(instrumentId: string, rows: EarningsData[], provider: string, fetchedAt: Date) {
  for (const r of rows) {
    await prisma.earningsEvent.upsert({
      where: { instrumentId_reportDate_provider: { instrumentId, reportDate: new Date(r.reportDate + "T00:00:00Z"), provider } },
      create: { instrumentId, reportDate: new Date(r.reportDate + "T00:00:00Z"), fiscalPeriodEnd: r.fiscalPeriodEnd ? new Date(r.fiscalPeriodEnd + "T00:00:00Z") : null, timeOfDay: r.timeOfDay, epsEstimate: r.epsEstimate, currency: r.currency, dateIsEstimated: true, provider, fetchedAt },
      update: { epsEstimate: r.epsEstimate, timeOfDay: r.timeOfDay, fetchedAt },
    });
  }
  return rows.length;
}

const toDate = (s: string | null) => (s ? new Date(s + "T00:00:00Z") : null);

/** Speichert normalisierte Politikertransaktionen mit Deduplizierung und Versionierung. */
export async function ingestPoliticianTx(rows: NormTx[], fetchedAt: Date, today: string, filingId: string | null = null) {
  const counts = { INSERT: 0, DUPLICATE: 0, SUPERSEDE: 0, DELETE_MARK: 0, REVIEW: 0 };
  for (const t of orderForIngest(assignOccurrences(rows))) {
    const ck = correctionKey(t);
    const existingRows = await prisma.politicianTransaction.findMany({ where: { OR: [{ dedupeKey: dedupeKey(t) }, { politicianName: t.politicianName, transactionDate: toDate(t.transactionDate) }] } });
    const stored: StoredTx[] = existingRows
      .map((e) => ({ id: e.id, dedupeKey: e.dedupeKey, correctionKey: correctionKey(dbToNorm(e)), txType: e.txType, amountMin: e.amountMin, amountMax: e.amountMax, version: e.version, isCurrent: e.isCurrent, filedDate: e.filedDate?.toISOString().slice(0, 10) ?? null }))
      .filter((s) => s.correctionKey === ck || s.dedupeKey === dedupeKey(t));
    const [a] = reconcile(stored, [t]);
    if (!a) continue;
    counts[a.kind]++;
    if (a.kind === "DUPLICATE") continue;
    const plaus = checkPlausibility(t, today);
    const st = statusFor(t, plaus);
    await prisma.$transaction(async (tx) => {
      let status: string = st.status;
      let needsReview = st.needsReview || a.kind === "REVIEW";
      if (a.kind === "SUPERSEDE" || a.kind === "DELETE_MARK") {
        await tx.politicianTransaction.updateMany({ where: { id: { in: a.targets } }, data: { isCurrent: false, status: "KORRIGIERT_ODER_ERSETZT" } });
      }
      if (a.kind === "DELETE_MARK") return;
      if (a.kind === "SUPERSEDE" && status !== "SEKUNDAERQUELLE") status = "KORRIGIERT_ODER_ERSETZT";
      if (a.kind === "INSERT" && t.sourceFilingStatus === "AMENDED") needsReview = true;
      const created = await tx.politicianTransaction.create({
        data: {
          filingId, source: t.source, politicianName: t.politicianName, bioguideId: t.bioguideId, chamber: t.chamber, party: t.party, state: t.state,
          owner: t.owner, assetName: t.assetName, ticker: t.ticker, tickerSource: t.tickerSource, instrumentKind: t.instrumentKind, txType: t.txType,
          transactionDate: toDate(t.transactionDate), notificationDate: toDate(t.notificationDate), filedDate: toDate(t.filedDate), publishedDate: toDate(t.publishedDate),
          amountMin: t.amountMin, amountMax: t.amountMax, amountText: t.amountText, rawText: t.rawText, status, sourceFilingStatus: t.sourceFilingStatus,
          extractionConfidence: t.extractionConfidence, uncertaintyFlags: [...t.uncertaintyFlags, ...plaus.hardErrors, ...plaus.warnings, ...(a.kind === "REVIEW" ? [a.reason] : [])] as Prisma.InputJsonValue,
          dedupeKey: a.dedupeKey, version: a.version, isCurrent: true, needsReview, fetchedAt,
        },
      });
      if (a.kind === "SUPERSEDE") await tx.politicianTransaction.updateMany({ where: { id: { in: a.targets } }, data: { supersededById: created.id } });
    });
  }
  return counts;
}

export function dbToNorm(e: { source: string; politicianName: string; bioguideId: string | null; chamber: string; party: string | null; state: string | null; owner: string; assetName: string; ticker: string | null; tickerSource: string | null; instrumentKind: string; txType: string; transactionDate: Date | null; notificationDate: Date | null; filedDate: Date | null; publishedDate: Date | null; amountMin: number | null; amountMax: number | null; amountText: string | null; sourceFilingStatus: string | null; rawText: string | null; extractionConfidence: number | null }): NormTx {
  const d = (x: Date | null) => x?.toISOString().slice(0, 10) ?? null;
  return {
    source: e.source, politicianName: e.politicianName, bioguideId: e.bioguideId, chamber: e.chamber as NormTx["chamber"], party: e.party, state: e.state,
    owner: e.owner as NormTx["owner"], assetName: e.assetName, ticker: e.ticker, tickerSource: e.tickerSource, instrumentKind: e.instrumentKind as NormTx["instrumentKind"],
    txType: e.txType as NormTx["txType"], transactionDate: d(e.transactionDate), notificationDate: d(e.notificationDate), filedDate: d(e.filedDate), publishedDate: d(e.publishedDate),
    amountMin: e.amountMin, amountMax: e.amountMax, amountText: e.amountText, sourceFilingStatus: e.sourceFilingStatus, rawText: e.rawText, uncertaintyFlags: [], extractionConfidence: e.extractionConfidence,
  };
}

export async function upsertFlows(rows: FlowRow[], fetchedAt: Date) {
  let n = 0;
  for (const r of rows) {
    const date = new Date(r.date + "T00:00:00Z");
    const prev = await prisma.fundFlow.findUnique({ where: { fundTicker_date_provider: { fundTicker: r.fundTicker, date, provider: r.provider } } });
    const revised = prev && prev.netFlow !== r.netFlow;
    await prisma.fundFlow.upsert({
      where: { fundTicker_date_provider: { fundTicker: r.fundTicker, date, provider: r.provider } },
      create: { fundTicker: r.fundTicker, issuer: r.issuer, assetClass: r.assetClass, date, netFlow: r.netFlow, flowUnit: r.flowUnit, aum: r.aum, volume: r.volume, closePrice: r.closePrice, status: r.status, provider: r.provider, fetchedAt },
      update: { netFlow: r.netFlow, aum: r.aum, volume: r.volume, closePrice: r.closePrice, fetchedAt, ...(revised ? { status: "REVIDIERT", revision: { increment: 1 } } : {}) },
    });
    n++;
  }
  return n;
}
