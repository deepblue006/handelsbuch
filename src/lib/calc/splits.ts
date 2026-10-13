/**
 * Split-Bereinigung unbereinigter Kursreihen anhand bekannter Split-Ereignisse.
 *
 * Konvention: factor = neue Stücke je altem Stück (4 = 4:1-Split, 0.1 = 1:10-Zusammenlegung).
 * Kurse VOR dem Wirksamkeitsdatum werden durch das Produkt aller späteren Faktoren geteilt,
 * Volumina damit multipliziert. Kurse ab dem Wirksamkeitsdatum bleiben unverändert.
 */
import { detectPossibleSplits, type Bar } from "./indicators";

export interface SplitEvent { date: string; factor: number; source: string }

export interface SplitAdjustResult {
  bars: Bar[];
  applied: SplitEvent[];
  /** Wochenkerzen, in deren Woche ein Split fällt: Open/High/Low nur näherungsweise bereinigt. */
  approximateBars: string[];
  /** Nach der Bereinigung verbleibende split-artige Kurssprünge (Datum, Faktor). */
  residualJumps: { date: string; factor: number }[];
  /** Verbleibende Sprünge nahe (±10 Tage) einem gemeldeten Split: Datum oder Faktor passen nicht zur Kursreihe. */
  mismatches: { date: string; factor: number; nearSplit: string }[];
}

const DAY = 86400000;
const t = (d: string) => Date.parse(d + "T00:00:00Z");

/** Gibt true zurück, wenn zwischen prevDate (exklusiv) und eff (exklusiv) mindestens ein Werktag liegt. */
function hasWeekdayBetween(prevDate: string, eff: string) {
  for (let x = t(prevDate) + DAY; x < t(eff); x += DAY) {
    const wd = new Date(x).getUTCDay();
    if (wd !== 0 && wd !== 6) return true;
  }
  return false;
}

/** Dedupliziert Splits je Datum; widersprüchliche Faktoren am selben Tag werden gemeldet, der erste (priorisierte) gilt. */
export function mergeSplits(events: SplitEvent[]): { splits: SplitEvent[]; conflicts: string[] } {
  const byDate = new Map<string, SplitEvent>();
  const conflicts: string[] = [];
  for (const e of events) {
    if (!(e.factor > 0) || e.factor === 1) continue;
    const prev = byDate.get(e.date);
    if (!prev) byDate.set(e.date, e);
    else if (Math.abs(prev.factor - e.factor) > 1e-9) conflicts.push(`${e.date}: ${prev.source} ${prev.factor} ≠ ${e.source} ${e.factor}`);
  }
  return { splits: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), conflicts };
}

export function adjustForSplits(bars: Bar[], events: SplitEvent[], interval: "DAY" | "WEEK"): SplitAdjustResult {
  const { splits } = mergeSplits(events);
  const relevant = splits.filter((s) => bars.length && s.date > bars[0]!.date && s.date <= bars.at(-1)!.date);
  const out: Bar[] = bars.map((b) => ({ ...b }));
  const approximateBars: string[] = [];
  for (const s of relevant) {
    const f = s.factor;
    for (let i = 0; i < out.length; i++) {
      const b = out[i]!;
      if (b.date < s.date) {
        b.close /= f;
        if (b.open != null) b.open /= f;
        if (b.high != null) b.high /= f;
        if (b.low != null) b.low /= f;
        if (b.volume != null) b.volume *= f;
      } else {
        // Wochenkerze mit Split innerhalb der Woche: Open vor, Close nach dem Split
        const prev = out[i - 1];
        if (interval === "WEEK" && prev && prev.date < s.date && hasWeekdayBetween(prev.date, s.date)) {
          if (b.open != null) b.open /= f;
          if (f > 1) { if (b.high != null) b.high = Math.max(b.high / f, b.close, b.open ?? -Infinity); }
          else if (b.low != null) b.low = Math.min(b.low / f, b.close, b.open ?? Infinity);
          approximateBars.push(b.date);
        }
        break;
      }
    }
  }
  const residualJumps = detectPossibleSplits(out);
  const mismatches = residualJumps.flatMap((j) => {
    const near = splits.find((s) => Math.abs(t(s.date) - t(j.date)) <= 10 * DAY);
    return near ? [{ ...j, nearSplit: near.date }] : [];
  });
  return { bars: out, applied: relevant, approximateBars, residualJumps, mismatches };
}

/** Liest ein Split-Verhältnis „neu:alt“ (z. B. „4:1“, „1:10“) oder einen Dezimalfaktor; null bei ungültiger Eingabe. */
export function parseSplitRatio(input: string): number | null {
  const s = input.trim().replace(",", ".");
  const m = /^(\d+(?:\.\d+)?)\s*[:/-]\s*(\d+(?:\.\d+)?)$/.exec(s);
  const f = m ? Number(m[1]) / Number(m[2]) : /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(f) && f > 0 && f !== 1 && f <= 1000 && f >= 0.001 ? f : null;
}

/** Darstellung „4:1“ bzw. „1:10“. */
export function formatSplitRatio(f: number): string {
  if (f >= 1) return `${Number.isInteger(f) ? f : f.toFixed(3).replace(/\.?0+$/, "")}:1`;
  const inv = 1 / f;
  return `1:${Math.abs(inv - Math.round(inv)) < 1e-6 ? Math.round(inv) : inv.toFixed(3).replace(/\.?0+$/, "")}`;
}
