/**
 * Lesezugriffe mit Quellenpriorität. Eine Zeitreihe stammt immer aus genau EINEM Provider
 * (keine stille Vermischung); gewählt wird die Quelle mit dem jüngsten Datenstand.
 */
import type { BarInterval, Instrument } from "@prisma/client";
import { prisma } from "../db";
import { FxTable, type FxRate } from "../calc/fx";
import type { Bar } from "../calc/indicators";
import type { PPrice } from "../calc/portfolio";

export const SNAPSHOT_PROVIDER = "alphavantage_snapshot";

export interface SeriesResult {
  bars: Bar[];
  provider: string | null;
  fetchedAt: Date | null;
  isDemo: boolean;
  isSnapshot: boolean;
  adjusted: boolean;
  currency: string | null;
}

export async function getBars(instrumentId: string, interval: BarInterval): Promise<SeriesResult> {
  const providers = await prisma.priceBar.groupBy({ by: ["provider"], where: { instrumentId, interval }, _max: { date: true }, _count: true });
  if (!providers.length) return { bars: [], provider: null, fetchedAt: null, isDemo: false, isSnapshot: false, adjusted: false, currency: null };
  providers.sort((a, b) => (b._max.date?.getTime() ?? 0) - (a._max.date?.getTime() ?? 0) || b._count - a._count);
  // Längere Historie bevorzugen, wenn die jüngste Quelle zu kurz für die SMA200 ist und die längere höchstens 7 Tage älter ist
  let chosen = providers[0]!;
  if (interval === "DAY" && chosen._count < 200) {
    const longer = providers.find((p) => p._count >= 200 && (chosen._max.date!.getTime() - (p._max.date?.getTime() ?? 0)) <= 7 * 86400000);
    if (longer) chosen = longer;
  }
  const provider = chosen.provider;
  const rows = await prisma.priceBar.findMany({ where: { instrumentId, interval, provider }, orderBy: { date: "asc" } });
  return {
    bars: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume })),
    provider,
    fetchedAt: rows.reduce<Date | null>((m, r) => (!m || r.fetchedAt > m ? r.fetchedAt : m), null),
    isDemo: rows.some((r) => r.isDemo),
    isSnapshot: provider === SNAPSHOT_PROVIDER,
    adjusted: rows.every((r) => r.adjusted),
    currency: rows[0]?.currency ?? null,
  };
}

export interface PriceInfo extends PPrice {
  interval: "DAY" | "WEEK" | "QUOTE";
  fetchedAt: Date | null;
  isSnapshot: boolean;
}

/** Letzter Schlusskurs: Tageskurs vor Wochenkurs; manuelle Quotes nur, wenn jünger. */
export async function latestPrice(inst: Pick<Instrument, "id" | "currency">): Promise<PriceInfo | null> {
  const [day, week, quote] = await Promise.all([
    prisma.priceBar.findFirst({ where: { instrumentId: inst.id, interval: "DAY" }, orderBy: [{ date: "desc" }, { fetchedAt: "desc" }] }),
    prisma.priceBar.findFirst({ where: { instrumentId: inst.id, interval: "WEEK" }, orderBy: [{ date: "desc" }, { fetchedAt: "desc" }] }),
    prisma.quote.findFirst({ where: { instrumentId: inst.id }, orderBy: { fetchedAt: "desc" } }),
  ]);
  const bar = day && (!week || day.date >= week.date) ? day : week;
  const cands: PriceInfo[] = [];
  if (bar) cands.push({ instrumentId: inst.id, price: bar.close, currency: bar.currency, asOf: bar.date.toISOString().slice(0, 10), source: bar.provider, isDemo: bar.isDemo, interval: bar.interval, fetchedAt: bar.fetchedAt, isSnapshot: bar.provider === SNAPSHOT_PROVIDER });
  if (quote?.last != null) cands.push({ instrumentId: inst.id, price: quote.last, currency: quote.currency, asOf: (quote.quoteTime ?? quote.fetchedAt).toISOString().slice(0, 10), source: quote.provider, isDemo: quote.isDemo, interval: "QUOTE", fetchedAt: quote.fetchedAt, isSnapshot: false });
  cands.sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0));
  return cands[0] ?? null;
}

export interface MacroResult {
  key: string;
  name: string;
  unit: string;
  provider: string;
  originalSource: string | null;
  sourceUrl: string | null;
  frequency: string;
  points: { date: string; value: number | null }[];
  fetchedAt: Date | null;
  isSnapshot: boolean;
}

/** Erste vorhandene Reihe aus einer Prioritätsliste von Schlüsseln. */
export async function macro(keys: string[], since?: string): Promise<MacroResult | null> {
  for (const key of keys) {
    const s = await prisma.macroSeries.findUnique({ where: { key } });
    if (!s) continue;
    const obs = await prisma.macroObservation.findMany({ where: { seriesKey: key, ...(since ? { date: { gte: new Date(since + "T00:00:00Z") } } : {}) }, orderBy: { date: "asc" } });
    if (!obs.length) continue;
    return {
      key, name: s.name, unit: s.unit, provider: s.provider, originalSource: s.originalSource, sourceUrl: s.sourceUrl, frequency: s.frequency,
      points: obs.map((o) => ({ date: o.date.toISOString().slice(0, 10), value: o.value })),
      fetchedAt: obs.reduce<Date | null>((m, o) => (!m || o.fetchedAt > m ? o.fetchedAt : m), null),
      isSnapshot: s.provider === SNAPSHOT_PROVIDER,
    };
  }
  return null;
}

export function lastValid(points: { date: string; value: number | null }[]) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i]!.value != null) return points[i] as { date: string; value: number };
  return null;
}

/** Wert am oder vor einem Datum (für Veränderungen über Zeiträume). */
export function valueAtOrBefore(points: { date: string; value: number | null }[], date: string) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i]!.date <= date && points[i]!.value != null) return points[i] as { date: string; value: number };
  return null;
}

/** Wechselkurstabelle: EZB-Referenzkurs > Alpha Vantage > FRED. */
export async function fxTable(): Promise<{ table: FxTable; rates: FxRate[] }> {
  const s = await macro(["ECB_EURUSD", "EURUSD", "FRED_USD_PER_EUR"]);
  const rates: FxRate[] = [];
  const lv = s ? lastValid(s.points) : null;
  if (s && lv) rates.push({ pair: "EURUSD", rate: lv.value, date: lv.date, source: `${s.provider}${s.isSnapshot ? " (Snapshot)" : ""}` });
  const manual = await prisma.setting.findUnique({ where: { key: "manualFx" } });
  for (const r of ((manual?.value as unknown as FxRate[]) ?? [])) if (r?.pair && r.rate > 0 && !rates.some((x) => x.pair === r.pair)) rates.push({ ...r, source: "manuell" });
  return { table: new FxTable(rates), rates };
}
