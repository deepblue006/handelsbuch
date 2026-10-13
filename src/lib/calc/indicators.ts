/**
 * Technische Indikatoren – reine Funktionen ohne Seiteneffekte.
 *
 * Konventionen:
 * - Eingabereihen sind aufsteigend nach Datum sortiert (ältester Wert zuerst).
 * - Ergebnisarrays haben dieselbe Länge wie die Eingabe; `null` bedeutet
 *   „nicht berechenbar“ (zu wenige Datenpunkte). Es wird nie aufgefüllt oder geschätzt.
 */

export interface Bar {
  date: string; // ISO yyyy-mm-dd
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  volume?: number | null;
}

export type Series = (number | null)[];

function assertPeriod(n: number) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Ungültige Periode: ${n}`);
}

/** Einfacher gleitender Durchschnitt (SMA) über n Werte. */
export function sma(values: number[], n: number): Series {
  assertPeriod(n);
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/**
 * Exponentieller gleitender Durchschnitt (EMA).
 * Startwert = SMA der ersten n Werte; danach EMA_t = α·x_t + (1−α)·EMA_{t−1}, α = 2/(n+1).
 */
export function ema(values: number[], n: number): Series {
  assertPeriod(n);
  const out: Series = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const alpha = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += values[i]!;
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = alpha * values[i]! + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index nach Wilder.
 * Erster Durchschnitt = einfacher Mittelwert der ersten n Kursänderungen,
 * danach geglättet: avg_t = (avg_{t−1}·(n−1) + x_t) / n.
 * RSI = 100 − 100/(1+RS). Kein Verlust → 100; weder Gewinn noch Verlust → 50.
 */
export function rsi(values: number[], n = 14): Series {
  assertPeriod(n);
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  out[n] = rsiFrom(avgGain, avgLoss);
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i]! - values[i - 1]!;
    avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function last<T>(arr: readonly T[]): T | undefined {
  return arr[arr.length - 1];
}

export function lastValue(s: Series): number | null {
  const v = s[s.length - 1];
  return v === undefined ? null : v;
}

/** Prozentualer Abstand des Kurses zu einer Referenz (z. B. 200-Tage-Linie). */
export function distancePct(price: number, ref: number | null): number | null {
  if (ref === null || ref === 0) return null;
  return ((price - ref) / ref) * 100;
}

// ---------------------------------------------------------------------------
// Kreuzungen (Golden Cross / Death Cross)
// ---------------------------------------------------------------------------

export interface CrossEvent {
  index: number;
  date: string;
  type: "GOLDEN_CROSS" | "DEATH_CROSS";
}

/** Kreuzungen der kurzen über/unter die lange Linie. Nur Indizes, an denen beide Linien existieren. */
export function findCrosses(dates: string[], fast: Series, slow: Series): CrossEvent[] {
  const events: CrossEvent[] = [];
  for (let i = 1; i < dates.length; i++) {
    const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
    if (f0 == null || s0 == null || f1 == null || s1 == null) continue;
    if (f0 <= s0 && f1 > s1) events.push({ index: i, date: dates[i]!, type: "GOLDEN_CROSS" });
    else if (f0 >= s0 && f1 < s1) events.push({ index: i, date: dates[i]!, type: "DEATH_CROSS" });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Wochenaggregation
// ---------------------------------------------------------------------------

/** ISO-Kalenderwoche als Schlüssel "YYYY-Www". */
export function isoWeekKey(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Mo = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Donnerstag der Woche
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Tageskerzen zu Wochenkerzen. Datum = letzter Handelstag der Woche, Close = letzter Schlusskurs.
 * Die laufende (unvollständige) Woche wird mit `complete=false` markiert, wenn `asOf` innerhalb dieser Woche liegt.
 */
export function toWeekly(bars: Bar[], asOf?: string): (Bar & { complete: boolean })[] {
  const out: (Bar & { complete: boolean })[] = [];
  let curKey = "";
  for (const b of bars) {
    const k = isoWeekKey(b.date);
    if (k !== curKey) {
      out.push({ ...b, complete: true });
      curKey = k;
    } else {
      const w = out[out.length - 1]!;
      w.date = b.date;
      w.close = b.close;
      if (b.high != null) w.high = w.high == null ? b.high : Math.max(w.high, b.high);
      if (b.low != null) w.low = w.low == null ? b.low : Math.min(w.low, b.low);
      if (b.volume != null) w.volume = (w.volume ?? 0) + b.volume;
    }
  }
  if (asOf && out.length) {
    const lastW = out[out.length - 1]!;
    const sameWeek = isoWeekKey(asOf) === isoWeekKey(lastW.date);
    const asOfDay = new Date(asOf + "T00:00:00Z").getUTCDay();
    // Woche gilt als vollständig erst ab Samstag/Sonntag
    if (sameWeek && asOfDay >= 1 && asOfDay <= 5) lastW.complete = false;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage-Analyse nach Weinstein (heuristische Umsetzung)
// ---------------------------------------------------------------------------

export type Stage = 1 | 2 | 3 | 4;

export interface StageResult {
  stage: Stage | null;
  label: string;
  ma30w: number | null;
  slopePct: number | null; // Veränderung der 30-Wochen-Linie über `slopeWeeks` in %
  priceVsMaPct: number | null;
  reclaimed: boolean; // 30-Wochen-Linie zuletzt zurückerobert
  confidence: "niedrig" | "mittel";
  method: string;
}

export interface StageParams {
  maWeeks: number; // 30
  slopeWeeks: number; // 4
  flatThresholdPct: number; // |Steigung| darunter = seitwärts
  priorTrendWeeks: number; // 20 – Vergleich für Stage 1 vs. 3
  reclaimLookback: number; // 4 – Wochen, in denen der Kurs zuvor unter der Linie lag
}

export const DEFAULT_STAGE_PARAMS: StageParams = {
  maWeeks: 30,
  slopeWeeks: 4,
  flatThresholdPct: 1.0,
  priorTrendWeeks: 20,
  reclaimLookback: 4,
};

/**
 * Regeln (dokumentiert, nicht von Weinstein selbst formalisiert):
 * - Linie steigt (> +Schwelle) und Kurs darüber → Stage 2
 * - Linie fällt (< −Schwelle) und Kurs darunter → Stage 4
 * - Linie seitwärts: lag sie vor `priorTrendWeeks` höher → Stage 1 (Boden), sonst Stage 3 (Top)
 * - Widersprüchliche Lage (z. B. Kurs über fallender Linie) → Übergang, Stage nach Linienrichtung, Konfidenz niedrig
 */
export function weinsteinStage(weeklyCloses: number[], p: StageParams = DEFAULT_STAGE_PARAMS): StageResult {
  const method = `30-Wochen-SMA (${p.maWeeks} Wochen), Steigung über ${p.slopeWeeks} Wochen, Seitwärtsschwelle ±${p.flatThresholdPct} %`;
  const ma = sma(weeklyCloses, p.maWeeks);
  const n = weeklyCloses.length;
  const cur = ma[n - 1] ?? null;
  const prev = ma[n - 1 - p.slopeWeeks] ?? null;
  if (cur == null || prev == null) {
    return { stage: null, label: "Zu wenige Wochenkurse", ma30w: cur, slopePct: null, priceVsMaPct: null, reclaimed: false, confidence: "niedrig", method };
  }
  const price = weeklyCloses[n - 1]!;
  const slopePct = ((cur - prev) / prev) * 100;
  const priceVsMaPct = ((price - cur) / cur) * 100;
  const above = price > cur;

  let reclaimed = false;
  if (above) {
    for (let k = 2; k <= p.reclaimLookback + 1 && n - k >= 0; k++) {
      const m = ma[n - k];
      if (m != null && weeklyCloses[n - k]! < m) { reclaimed = true; break; }
    }
  }

  const rising = slopePct > p.flatThresholdPct;
  const falling = slopePct < -p.flatThresholdPct;
  let stage: Stage;
  let confidence: "niedrig" | "mittel" = "mittel";
  if (rising && above) stage = 2;
  else if (falling && !above) stage = 4;
  else if (!rising && !falling) {
    const older = ma[n - 1 - p.priorTrendWeeks] ?? null;
    if (older == null) { stage = above ? 1 : 3; confidence = "niedrig"; }
    else stage = older > cur ? 1 : 3;
  } else {
    // Kurs über fallender Linie → mögliche Bodenbildung; Kurs unter steigender Linie → mögliche Topbildung
    stage = falling ? 1 : 3;
    confidence = "niedrig";
  }
  const labels: Record<Stage, string> = {
    1: "Stage 1 – Bodenbildung",
    2: "Stage 2 – Aufwärtstrend",
    3: "Stage 3 – Topbildung",
    4: "Stage 4 – Abwärtstrend",
  };
  return { stage, label: labels[stage], ma30w: cur, slopePct, priceVsMaPct, reclaimed, confidence, method };
}

// ---------------------------------------------------------------------------
// Fibonacci
// ---------------------------------------------------------------------------

export interface FibResult {
  swingLow: { date: string; price: number };
  swingHigh: { date: string; price: number };
  direction: "AUFWÄRTS" | "ABWÄRTS"; // Richtung der zuletzt abgeschlossenen Bewegung
  levels: { ratio: number; price: number }[];
  goldenPocket: { from: number; to: number };
  method: string;
}

export const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];

/**
 * Fibonacci-Retracements aus Hoch und Tief eines festen Rückblickfensters, das am
 * Entscheidungszeitpunkt `endIndex` endet. Es werden ausschließlich Daten bis einschließlich
 * `endIndex` verwendet (kein Look-ahead).
 * Aufwärtsbewegung (Tief vor Hoch): Level = Hoch − (Hoch − Tief)·r
 * Abwärtsbewegung (Hoch vor Tief): Level = Tief + (Hoch − Tief)·r
 * Golden Pocket: Bereich zwischen den Ratios 0,618 und 0,65.
 */
export function fibonacci(bars: Bar[], lookback = 126, endIndex = bars.length - 1, unit = "Handelstage"): FibResult | null {
  if (endIndex < 1 || bars.length === 0) return null;
  const start = Math.max(0, endIndex - lookback + 1);
  let hi = -Infinity, lo = Infinity, hiIdx = -1, loIdx = -1;
  for (let i = start; i <= endIndex; i++) {
    const b = bars[i]!;
    const h = b.high ?? b.close;
    const l = b.low ?? b.close;
    if (h > hi) { hi = h; hiIdx = i; }
    if (l < lo) { lo = l; loIdx = i; }
  }
  if (hiIdx < 0 || loIdx < 0 || hi === lo) return null;
  const up = loIdx < hiIdx;
  const range = hi - lo;
  const lvl = (r: number) => (up ? hi - range * r : lo + range * r);
  return {
    swingLow: { date: bars[loIdx]!.date, price: lo },
    swingHigh: { date: bars[hiIdx]!.date, price: hi },
    direction: up ? "AUFWÄRTS" : "ABWÄRTS",
    levels: FIB_RATIOS.map((ratio) => ({ ratio, price: lvl(ratio) })),
    goldenPocket: { from: Math.min(lvl(0.618), lvl(0.65)), to: Math.max(lvl(0.618), lvl(0.65)) },
    method: `Höchst- und Tiefstkurs der letzten ${Math.min(lookback, endIndex - start + 1)} ${unit} bis ${bars[endIndex]!.date} (Hoch/Tief der Kerzen)`,
  };
}

/** Konfluenz: liegt ein Fibonacci-Level innerhalb `tolPct` % einer Referenz (z. B. 200-Tage-Linie)? */
export function confluence(levels: { ratio: number; price: number }[], ref: number | null, tolPct = 1.5) {
  if (ref == null) return [];
  return levels.filter((l) => Math.abs((l.price - ref) / ref) * 100 <= tolPct);
}

// ---------------------------------------------------------------------------
// Spread, ADR, Volumen
// ---------------------------------------------------------------------------

export interface SpreadResult {
  spreadAbs: number;
  spreadPct: number;
  quoteTime: string;
  stale: boolean;
  ageSeconds: number;
}

/** Spread in % = (Brief − Geld) ÷ Geld × 100. Veraltete Kurse werden als `stale` markiert. */
export function spreadPct(bid: number, ask: number, quoteTime: Date, now: Date, maxAgeSeconds = 900): SpreadResult | null {
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  const ageSeconds = Math.round((now.getTime() - quoteTime.getTime()) / 1000);
  return {
    spreadAbs: ask - bid,
    spreadPct: ((ask - bid) / bid) * 100,
    quoteTime: quoteTime.toISOString(),
    stale: ageSeconds > maxAgeSeconds,
    ageSeconds,
  };
}

/**
 * Average Daily Range über n Tage.
 * absolut: Mittelwert(Hoch − Tief); prozentual: 100 · (Mittelwert(Hoch/Tief) − 1).
 */
export function adr(bars: Bar[], n = 20): { abs: number; pct: number; days: number } | null {
  const valid = bars.filter((b) => b.high != null && b.low != null && b.low! > 0);
  if (valid.length < n) return null;
  const slice = valid.slice(-n);
  const abs = slice.reduce((s, b) => s + (b.high! - b.low!), 0) / n;
  const ratio = slice.reduce((s, b) => s + b.high! / b.low!, 0) / n;
  return { abs, pct: (ratio - 1) * 100, days: n };
}

/** Durchschnittsvolumen an Tagen mit steigendem bzw. fallendem Schlusskurs. */
export function upDownVolume(bars: Bar[], n = 50) {
  const slice = bars.slice(-(n + 1));
  let upV = 0, upN = 0, downV = 0, downN = 0;
  for (let i = 1; i < slice.length; i++) {
    const b = slice[i]!;
    if (b.volume == null) continue;
    if (b.close > slice[i - 1]!.close) { upV += b.volume; upN++; }
    else if (b.close < slice[i - 1]!.close) { downV += b.volume; downN++; }
  }
  if (upN + downN === 0) return null;
  return {
    avgUpVolume: upN ? upV / upN : null,
    avgDownVolume: downN ? downV / downN : null,
    ratio: upN && downN ? upV / upN / (downV / downN) : null,
    upDays: upN,
    downDays: downN,
  };
}

// ---------------------------------------------------------------------------
// Unterstützungen, Widerstände, runde Marken
// ---------------------------------------------------------------------------

export interface Pivot {
  index: number;
  date: string;
  price: number;
  kind: "HOCH" | "TIEF";
  confirmedAt: string; // Datum, ab dem der Pivot bekannt sein konnte (index + k)
}

/** Lokale Hochs/Tiefs mit Fensterbreite k. Ein Pivot ist erst k Kerzen später bestätigt. */
export function pivots(bars: Bar[], k = 5): Pivot[] {
  const out: Pivot[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const h = bars[i]!.high ?? bars[i]!.close;
    const l = bars[i]!.low ?? bars[i]!.close;
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const hj = bars[j]!.high ?? bars[j]!.close;
      const lj = bars[j]!.low ?? bars[j]!.close;
      if (hj >= h) isHigh = false;
      if (lj <= l) isLow = false;
    }
    if (isHigh) out.push({ index: i, date: bars[i]!.date, price: h, kind: "HOCH", confirmedAt: bars[i + k]!.date });
    if (isLow) out.push({ index: i, date: bars[i]!.date, price: l, kind: "TIEF", confirmedAt: bars[i + k]!.date });
  }
  return out;
}

export interface Zone {
  low: number;
  high: number;
  mid: number;
  touches: number;
  kind: "UNTERSTÜTZUNG" | "WIDERSTAND";
  lastTouch: string;
}

/** Bündelt Pivots, die innerhalb `tolPct` % beieinander liegen, zu Zonen. Einordnung relativ zum aktuellen Kurs. */
export function zonesFromPivots(pv: Pivot[], currentPrice: number, tolPct = 1.5, minTouches = 2): Zone[] {
  const sorted = [...pv].sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && Math.abs(p.price - c[0]!.price) / c[0]!.price * 100 <= tolPct) c.push(p);
    else clusters.push([p]);
  }
  return clusters
    .filter((c) => c.length >= minTouches)
    .map((c) => {
      const prices = c.map((p) => p.price);
      const low = Math.min(...prices), high = Math.max(...prices);
      const mid = (low + high) / 2;
      return {
        low, high, mid,
        touches: c.length,
        kind: mid <= currentPrice ? ("UNTERSTÜTZUNG" as const) : ("WIDERSTAND" as const),
        lastTouch: c.map((p) => p.date).sort().at(-1)!,
      };
    });
}

/** Psychologisch runde Marken in der Nähe des Kurses (Schrittweite abhängig von der Größenordnung). */
export function roundLevels(price: number, count = 2): number[] {
  if (!(price > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(price)));
  const step = price / mag >= 5 ? mag : mag / 2;
  const base = Math.floor(price / step) * step;
  const out: number[] = [];
  for (let i = -count + 1; i <= count; i++) out.push(+(base + i * step).toFixed(8));
  return out.filter((x) => x > 0);
}

// ---------------------------------------------------------------------------
// Renditen, Volatilität, Datenqualität
// ---------------------------------------------------------------------------

export function pctChange(from: number, to: number): number | null {
  if (!(from > 0)) return null;
  return ((to - from) / from) * 100;
}

/** Annualisierte Volatilität aus Log-Renditen. periodsPerYear: 252 Aktien, 365 Krypto, 52 Wochen. */
export function annualizedVolatility(closes: number[], periodsPerYear = 252): number | null {
  if (closes.length < 3) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1]! > 0 && closes[i]! > 0) r.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  if (r.length < 2) return null;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;
}

const SPLIT_RATIOS = [2, 3, 4, 5, 7, 8, 10, 15, 20];

/**
 * Erkennt mögliche, nicht bereinigte Aktiensplits in einer Rohkursreihe
 * (Sprung um ≈ Faktor 1/2, 1/3 … zwischen zwei aufeinanderfolgenden Kursen).
 * Ergebnis ist ein Warnhinweis, keine Gewissheit.
 * Toleranz ohne Angabe: 4 % bei Tageskursen, 10 % bei Wochen-/Monatskursen (Median-Abstand ≥ 5 Tage) –
 * dort steckt neben dem Split eine ganze Woche Kursbewegung im Sprung (z. B. XLU 12/2025: Faktor 2,09).
 */
export function detectPossibleSplits(bars: Bar[], tolPct?: number): { date: string; factor: number }[] {
  const tol = tolPct ?? (medianGapDays(bars) >= 5 ? 10 : 4);
  const out: { date: string; factor: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.close, cur = bars[i]!.close;
    if (!(prev > 0) || !(cur > 0)) continue;
    const ratio = prev / cur;
    for (const f of SPLIT_RATIOS) {
      if (Math.abs(ratio - f) / f * 100 <= tol) out.push({ date: bars[i]!.date, factor: f });
      else if (Math.abs(1 / ratio - f) / f * 100 <= tol) out.push({ date: bars[i]!.date, factor: 1 / f });
    }
  }
  return out;
}

/** Median-Abstand in Tagen zwischen aufeinanderfolgenden Kursen (höchstens die ersten 20 Abstände). */
function medianGapDays(bars: Bar[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < bars.length && gaps.length < 20; i++) gaps.push((Date.parse(bars[i]!.date) - Date.parse(bars[i - 1]!.date)) / 86400000);
  if (!gaps.length) return 1;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

/** Prüft, ob ausreichend Datenpunkte für einen Indikator vorliegen. */
export function enoughData(len: number, required: number): { ok: boolean; have: number; need: number } {
  return { ok: len >= required, have: len, need: required };
}
