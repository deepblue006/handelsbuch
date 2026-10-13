/**
 * Abrufplan für Alpha Vantage (Free: 25 Abrufe/Tag).
 * Jeder Datensatz hat ein fachlich begründetes Intervall – Wochenkurse ändern sich erst nach Wochenschluss,
 * 13F-Bestände quartalsweise usw. Fällige Abrufe werden nach Priorität ins Restkontingent gelegt,
 * der Rest wird aufgeschoben (nicht als Störung gewertet).
 */
import { isNyseTradingDay } from "../calc/us-holidays";

export type AvJobKind = "daily" | "weekly" | "macro" | "crypto" | "earnings" | "estimates" | "congress" | "insider" | "institutional" | "splits";

export interface AvJob { dataset: string; kind: AvJobKind; symbol: string | null; priority: number }

export interface AvInstrument {
  symbol: string;
  assetType: string;
  held: boolean; // Bestand oder Watchlist
  isIndexProxy: boolean;
  isSectorEtf: boolean;
  inBreadthUniverse: boolean;
  splitsManual: boolean; // Splitliste manuell bestätigt → kein Provider-Abruf
  splitsCheckedAt: Date | null;
  hasCoinGecko: boolean;
}

const HOUR = 3600_000, DAY = 24 * HOUR;
/** US-Handelsschluss 16:00 ET ≈ 21:00/22:00 UTC; 22:15 UTC liegt sicher danach (Sommer- und Winterzeit). */
const US_CLOSE_UTC_MIN = 22 * 60 + 15;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Letzter abgeschlossener NYSE-Handelstag (Wochenenden und regelbasierte Feiertage ausgenommen) als Zeitpunkt nach Handelsschluss. */
export function lastUsCloseCutoff(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, US_CLOSE_UTC_MIN));
  if (d > now) d.setUTCDate(d.getUTCDate() - 1);
  while (!isNyseTradingDay(isoDay(d))) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Letzter Wochenschluss: letzter Handelstag der jüngsten vollständig abgeschlossenen Handelswoche (Karfreitag → Donnerstag). */
export function lastWeekCloseCutoff(now: Date): Date {
  const d = lastUsCloseCutoff(now);
  const rest = new Date(d);
  // Folgen in derselben Woche (bis Freitag) noch Handelstage, ist die Woche nicht abgeschlossen
  for (rest.setUTCDate(rest.getUTCDate() + 1); rest.getUTCDay() >= 1 && rest.getUTCDay() <= 5; rest.setUTCDate(rest.getUTCDate() + 1)) {
    if (isNyseTradingDay(isoDay(rest))) {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 1); // Sonntag davor
      while (!isNyseTradingDay(isoDay(d))) d.setUTCDate(d.getUTCDate() - 1);
      break;
    }
  }
  return d;
}

function utcMidnight(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export const CADENCE: Record<AvJobKind, { label: string; cutoff: (now: Date) => Date | null; maxAgeMs: number | null }> = {
  daily: { label: "nach jedem US-Handelsschluss", cutoff: lastUsCloseCutoff, maxAgeMs: null },
  macro: { label: "nach jedem US-Handelsschluss", cutoff: lastUsCloseCutoff, maxAgeMs: null },
  weekly: { label: "nach Wochenschluss (Freitag)", cutoff: lastWeekCloseCutoff, maxAgeMs: null },
  crypto: { label: "täglich nach 00:00 UTC (Tageskerze abgeschlossen)", cutoff: utcMidnight, maxAgeMs: null },
  congress: { label: "nach jedem US-Handelsschluss", cutoff: lastUsCloseCutoff, maxAgeMs: null },
  earnings: { label: "wöchentlich", cutoff: () => null, maxAgeMs: 7 * DAY },
  estimates: { label: "wöchentlich", cutoff: () => null, maxAgeMs: 7 * DAY },
  insider: { label: "wöchentlich", cutoff: () => null, maxAgeMs: 7 * DAY },
  institutional: { label: "monatlich (13F quartalsweise)", cutoff: () => null, maxAgeMs: 30 * DAY },
  splits: { label: "monatlich", cutoff: () => null, maxAgeMs: 30 * DAY },
};

export function isDue(kind: AvJobKind, lastSuccess: Date | null, now: Date): boolean {
  if (!lastSuccess) return true;
  const c = CADENCE[kind];
  const cut = c.cutoff(now);
  if (cut && lastSuccess < cut) return true;
  if (c.maxAgeMs != null && now.getTime() - lastSuccess.getTime() >= c.maxAgeMs) return true;
  return false;
}

/** Nächster Fälligkeitszeitpunkt (Näherung für die Anzeige). */
export function nextDue(kind: AvJobKind, lastSuccess: Date | null, now: Date): Date {
  if (!lastSuccess || isDue(kind, lastSuccess, now)) return now;
  const c = CADENCE[kind];
  if (c.maxAgeMs != null) return new Date(lastSuccess.getTime() + c.maxAgeMs);
  // Nächsten Cutoff nach jetzt suchen (stündlich vorwärts, höchstens 8 Tage)
  for (let t = now.getTime() + HOUR; t < now.getTime() + 8 * DAY; t += HOUR) {
    if (isDue(kind, lastSuccess, new Date(t))) return new Date(t);
  }
  return new Date(now.getTime() + 8 * DAY);
}

const MACRO_KEYS = ["US10Y", "EFFR", "EURUSD", "WTI", "BRENT", "GOLD_USD"];

/**
 * Alle möglichen Abrufe mit Priorität (kleiner = wichtiger):
 * Tageskurse Bestand/Watchlist/Indizes → Makro → Wochenkurse Bestand/Indizes → Krypto → Termine → Konsens
 * → Wochenkurse Sektoren → Kongress → Insider → 13F → Splits.
 */
export function buildJobs(instruments: AvInstrument[], now: Date): AvJob[] {
  const jobs: AvJob[] = [];
  const add = (kind: AvJobKind, dataset: string, symbol: string | null, priority: number) => jobs.push({ kind, dataset, symbol, priority });
  const nonCrypto = instruments.filter((i) => i.assetType !== "CRYPTO");
  const stocks = instruments.filter((i) => i.assetType === "STOCK");
  for (const i of nonCrypto) if (!i.isSectorEtf) add("daily", `daily:${i.symbol}`, i.symbol, i.held || i.isIndexProxy ? 10 : 15);
  MACRO_KEYS.forEach((k, n) => add("macro", `macro:${k}`, null, 20 + n * 0.1));
  for (const i of nonCrypto) add("weekly", `weekly:${i.symbol}`, i.symbol, i.isSectorEtf ? 60 : i.held || i.isIndexProxy ? 30 : 35);
  for (const i of instruments.filter((x) => x.assetType === "CRYPTO" && !x.hasCoinGecko)) add("crypto", `crypto:${i.symbol}`, i.symbol, 40);
  for (const i of stocks) add("earnings", `earnings:${i.symbol}`, i.symbol, 45);
  for (const i of stocks) add("estimates", `estimates:${i.symbol}`, i.symbol, 50);
  for (const i of stocks) add("congress", `congress:${i.symbol}`, i.symbol, 70);
  for (const i of stocks) add("insider", `insider:${i.symbol}`, i.symbol, 75);
  for (const i of stocks) add("institutional", `institutional:${i.symbol}`, i.symbol, 80);
  for (const i of nonCrypto) if (!i.splitsManual && isDue("splits", i.splitsCheckedAt, now)) add("splits", `splits:${i.symbol}`, i.symbol, 90);
  // stabile Sortierung: Priorität, dann ursprüngliche Reihenfolge
  return jobs.map((j, idx) => ({ j, idx })).sort((a, b) => a.j.priority - b.j.priority || a.idx - b.idx).map((x) => x.j);
}

export interface AvPlan {
  run: AvJob[];
  deferred: AvJob[];
  notDue: { job: AvJob; lastSuccess: Date; nextDue: Date }[];
  remaining: number;
}

export function planJobs(jobs: AvJob[], lastSuccess: Map<string, Date>, now: Date, remaining: number): AvPlan {
  const due: AvJob[] = [];
  const notDue: AvPlan["notDue"] = [];
  for (const j of jobs) {
    const last = lastSuccess.get(j.dataset) ?? null;
    // Splits: Fälligkeit bereits über splitsCheckedAt geprüft
    if (j.kind === "splits" || isDue(j.kind, last, now)) due.push(j);
    else notDue.push({ job: j, lastSuccess: last!, nextDue: nextDue(j.kind, last, now) });
  }
  const n = Math.max(0, remaining);
  return { run: due.slice(0, n), deferred: due.slice(n), notDue, remaining: n };
}
