/**
 * Einfacher Ereignis-Backtest für Kurs-Signale (z. B. RSI 14 < 30, Rückeroberung 30W).
 *
 * Methodik (im Dashboard angezeigt):
 * - Das Signal am Tag t wird ausschließlich aus Daten bis einschließlich t berechnet (kein Look-ahead).
 * - Einstieg zum Schlusskurs der FOLGENDEN Kerze (t+1), Ausstieg nach `holdBars` Kerzen.
 * - Gebühren je Kauf+Verkauf in Prozent werden abgezogen.
 * - Vergleich: unbedingte Rendite über denselben Haltezeitraum an allen Tagen (Basisrate).
 * - Überlappende Signale werden durch eine Sperrfrist von `holdBars` vermieden.
 * - Rohkurse (nicht split-bereinigt) sind ungeeignet: mögliche Splits führen zum Abbruch.
 * Grenzen: Survivorship-Bias der Titelauswahl, nur ein Titel, keine Steuern/Slippage, keine Aussage über die Zukunft.
 */
import { detectPossibleSplits, type Bar, type Series } from "./indicators";

export interface BacktestResult {
  status: "OK" | "NICHT_AUSREICHEND" | "UNGEEIGNET";
  reason: string;
  signals: { date: string; entry: number; exit: number; returnPct: number }[];
  sampleSize: number;
  avgReturnPct: number | null;
  medianReturnPct: number | null;
  hitRatePct: number | null;
  baselineAvgPct: number | null;
  period: { from: string | null; to: string | null };
  method: string;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function eventBacktest(bars: Bar[], signal: (i: number) => boolean, opts: { holdBars: number; feePct?: number; minSamples?: number; adjusted: boolean }): BacktestResult {
  const fee = opts.feePct ?? 0.2;
  const min = opts.minSamples ?? 20;
  const method = `Signal aus Daten bis t, Einstieg Schlusskurs t+1, Ausstieg nach ${opts.holdBars} Kerzen, Gebühren ${fee} % je Runde, Sperrfrist gegen Überlappung; Basisrate = alle Startpunkte.`;
  const base: BacktestResult = { status: "NICHT_AUSREICHEND", reason: "", signals: [], sampleSize: 0, avgReturnPct: null, medianReturnPct: null, hitRatePct: null, baselineAvgPct: null, period: { from: bars[0]?.date ?? null, to: bars.at(-1)?.date ?? null }, method };
  if (!opts.adjusted && detectPossibleSplits(bars).length) return { ...base, status: "UNGEEIGNET", reason: "Kursreihe nicht split-bereinigt und enthält mögliche Splits – Ergebnisse wären verfälscht." };
  const sig: BacktestResult["signals"] = [];
  let blockedUntil = -1;
  for (let i = 0; i + 1 + opts.holdBars < bars.length; i++) {
    if (i <= blockedUntil || !signal(i)) continue;
    const entry = bars[i + 1]!.close, exit = bars[i + 1 + opts.holdBars]!.close;
    sig.push({ date: bars[i]!.date, entry, exit, returnPct: ((exit - entry) / entry) * 100 - fee });
    blockedUntil = i + opts.holdBars;
  }
  const baseRets: number[] = [];
  for (let i = 1; i + opts.holdBars < bars.length; i++) baseRets.push(((bars[i + opts.holdBars]!.close - bars[i]!.close) / bars[i]!.close) * 100 - fee);
  const r = sig.map((s) => s.returnPct);
  const res = {
    ...base, signals: sig, sampleSize: sig.length,
    avgReturnPct: r.length ? r.reduce((s, x) => s + x, 0) / r.length : null,
    medianReturnPct: r.length ? median(r) : null,
    hitRatePct: r.length ? (r.filter((x) => x > 0).length / r.length) * 100 : null,
    baselineAvgPct: baseRets.length ? baseRets.reduce((s, x) => s + x, 0) / baseRets.length : null,
  };
  if (sig.length < min) return { ...res, status: "NICHT_AUSREICHEND", reason: `Nur ${sig.length} Signale (Minimum ${min}) – kein belastbarer Backtest.` };
  return { ...res, status: "OK", reason: "Historisches Ergebnis – kein Beweis für zukünftigen Erfolg." };
}

/** Signal-Helfer: Wert der Reihe unter Schwelle (nur Daten bis i). */
export const below = (s: Series, threshold: number) => (i: number) => s[i] != null && s[i]! < threshold;
