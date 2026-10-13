/**
 * Sektorrotation und Saisonalität – beschreibende Statistik, keine Prognose.
 */
import { detectPossibleSplits, type Bar } from "./indicators";

export interface SectorInput { symbol: string; label: string; bars: Bar[] }

export interface SectorRow {
  symbol: string;
  label: string;
  lastDate: string | null;
  returns: Record<number, number | null>; // Rendite in % je Fenster (Wochen)
  relative: Record<number, number | null>; // Rendite minus Benchmark-Rendite (Prozentpunkte)
  splitInWindow: Record<number, boolean>;
  rsTrend: "VERBESSERT" | "VERSCHLECHTERT" | "UNVERÄNDERT" | null; // 4W-Relativ vs. 13W-Relativ/3,25
}

/** Rendite über die letzten n Wochen; null bei zu kurzer Historie, unterschiedlichem Enddatum oder Split im Fenster. */
function windowReturn(bars: Bar[], n: number, endDate: string) {
  const idx = bars.findIndex((b) => b.date === endDate);
  if (idx < n) return { r: null, split: false };
  const slice = bars.slice(idx - n, idx + 1);
  const split = detectPossibleSplits(slice).length > 0;
  if (split) return { r: null, split: true };
  return { r: ((slice.at(-1)!.close - slice[0]!.close) / slice[0]!.close) * 100, split: false };
}

export function sectorRotation(sectors: SectorInput[], benchmark: Bar[], windows = [4, 13, 26, 52]): { rows: SectorRow[]; endDate: string | null; method: string } {
  const endDate = benchmark.at(-1)?.date ?? null;
  const method = `Wochenschlusskurse bis ${endDate ?? "–"}; Rendite über 4/13/26/52 Wochen; relativ = Sektor − Benchmark (Prozentpunkte). Werte mit möglichem Split im Fenster werden ausgelassen (Rohkurse).`;
  if (!endDate) return { rows: [], endDate, method };
  const rows = sectors.map((s) => {
    const returns: Record<number, number | null> = {}, relative: Record<number, number | null> = {}, splitInWindow: Record<number, boolean> = {};
    for (const w of windows) {
      const own = windowReturn(s.bars, w, endDate);
      const bm = windowReturn(benchmark, w, endDate);
      returns[w] = own.r;
      splitInWindow[w] = own.split;
      relative[w] = own.r != null && bm.r != null ? own.r - bm.r : null;
    }
    const r4 = relative[4], r13 = relative[13];
    const rsTrend = r4 == null || r13 == null ? null : r4 > r13 / 3.25 + 0.5 ? "VERBESSERT" : r4 < r13 / 3.25 - 0.5 ? "VERSCHLECHTERT" : "UNVERÄNDERT";
    return { symbol: s.symbol, label: s.label, lastDate: s.bars.at(-1)?.date ?? null, returns, relative, splitInWindow, rsTrend } as SectorRow;
  });
  return { rows, endDate, method };
}

export interface MonthStat { month: number; n: number; avgPct: number | null; medianPct: number | null; positivePct: number | null }

/**
 * Monatsrenditen aus dem letzten Wochenschluss je Kalendermonat (Näherung an Monatsultimo).
 * Nur vollständige Monate; laufender Monat ausgeschlossen. Mögliche Splits im Monat → Monat ausgelassen.
 */
export function seasonality(bars: Bar[], today: string, minYears = 10): { stats: MonthStat[]; years: number; from: string | null; to: string | null; sufficient: boolean } {
  const lastOfMonth = new Map<string, Bar>();
  for (const b of bars) lastOfMonth.set(b.date.slice(0, 7), b);
  const months = [...lastOfMonth.keys()].sort().filter((m) => m < today.slice(0, 7));
  const rets: { month: number; r: number }[] = [];
  for (let i = 1; i < months.length; i++) {
    const a = lastOfMonth.get(months[i - 1]!)!, b = lastOfMonth.get(months[i]!)!;
    const within = bars.filter((x) => x.date > a.date && x.date <= b.date);
    if (detectPossibleSplits([a, ...within]).length) continue;
    rets.push({ month: Number(months[i]!.slice(5, 7)), r: ((b.close - a.close) / a.close) * 100 });
  }
  const stats: MonthStat[] = Array.from({ length: 12 }, (_, k) => {
    const xs = rets.filter((x) => x.month === k + 1).map((x) => x.r).sort((p, q) => p - q);
    if (!xs.length) return { month: k + 1, n: 0, avgPct: null, medianPct: null, positivePct: null };
    const mid = Math.floor(xs.length / 2);
    return { month: k + 1, n: xs.length, avgPct: xs.reduce((s, x) => s + x, 0) / xs.length, medianPct: xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2, positivePct: (xs.filter((x) => x > 0).length / xs.length) * 100 };
  });
  const years = Math.min(...stats.map((s) => s.n));
  return { stats, years, from: months[0] ?? null, to: months.at(-1) ?? null, sufficient: years >= minYears };
}
