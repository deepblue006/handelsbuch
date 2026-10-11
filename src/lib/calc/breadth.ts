/**
 * Marktbreite: Anteil der beobachteten Titel über ihrer 200-Tage-Linie.
 *
 * Methode (dokumentiert und im Dashboard angezeigt):
 * - Universum = explizit konfigurierte Liste (Instrument.inBreadthUniverse), nicht „der Markt“.
 * - Für jeden Titel wird am Stichtag der letzte Schlusskurs ≤ Stichtag mit der SMA200
 *   der Tagesschlusskurse bis einschließlich dieses Kurses verglichen.
 * - Titel mit weniger als 200 Tageskursen oder einem Kurs älter als `maxStaleDays`
 *   zählen als „nicht auswertbar“ und gehen nicht in den Prozentwert ein.
 */
import { sma } from "./indicators";

export interface BreadthMemberInput {
  symbol: string;
  bars: { date: string; close: number }[]; // aufsteigend
}

export interface BreadthMember {
  symbol: string;
  status: "ÜBER" | "UNTER" | "NICHT_AUSWERTBAR";
  close: number | null;
  sma200: number | null;
  date: string | null;
  reason?: string;
}

export interface BreadthResult {
  asOf: string;
  pctAbove: number | null;
  pctBelow: number | null;
  evaluated: number;
  universeSize: number;
  members: BreadthMember[];
  method: string;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function breadthAt(universe: BreadthMemberInput[], asOf: string, period = 200, maxStaleDays = 5): BreadthResult {
  const members: BreadthMember[] = universe.map((m) => {
    const upto = m.bars.filter((b) => b.date <= asOf);
    if (upto.length < period) return { symbol: m.symbol, status: "NICHT_AUSWERTBAR", close: null, sma200: null, date: null, reason: `nur ${upto.length} von ${period} Tageskursen` };
    const lastBar = upto[upto.length - 1]!;
    if (daysBetween(lastBar.date, asOf) > maxStaleDays) return { symbol: m.symbol, status: "NICHT_AUSWERTBAR", close: lastBar.close, sma200: null, date: lastBar.date, reason: `letzter Kurs vom ${lastBar.date} zu alt` };
    const s = sma(upto.slice(-period).map((b) => b.close), period)[period - 1]!;
    return { symbol: m.symbol, status: lastBar.close > s! ? "ÜBER" : "UNTER", close: lastBar.close, sma200: s, date: lastBar.date };
  });
  const evaluated = members.filter((m) => m.status !== "NICHT_AUSWERTBAR").length;
  const above = members.filter((m) => m.status === "ÜBER").length;
  return {
    asOf,
    pctAbove: evaluated ? (above / evaluated) * 100 : null,
    pctBelow: evaluated ? ((evaluated - above) / evaluated) * 100 : null,
    evaluated,
    universeSize: universe.length,
    members,
    method: `Anteil der auswertbaren Titel des konfigurierten Universums mit Schlusskurs über der SMA${period} der Tagesschlusskurse; nicht auswertbar bei < ${period} Kursen oder Kurs älter als ${maxStaleDays} Tage.`,
  };
}

/** Zeitreihe der Marktbreite für mehrere Stichtage (z. B. wöchentlich). */
export function breadthSeries(universe: BreadthMemberInput[], dates: string[], period = 200) {
  return dates.map((d) => {
    const r = breadthAt(universe, d, period);
    return { date: d, pctAbove: r.pctAbove, evaluated: r.evaluated };
  });
}

/** Abstand des Index zu seinem Allzeithoch innerhalb der vorliegenden Historie. */
export function drawdownFromHigh(closes: { date: string; close: number }[]) {
  if (!closes.length) return null;
  let hi = closes[0]!;
  for (const c of closes) if (c.close > hi.close) hi = c;
  const last = closes[closes.length - 1]!;
  return { high: hi.close, highDate: hi.date, last: last.close, lastDate: last.date, drawdownPct: ((last.close - hi.close) / hi.close) * 100 };
}
