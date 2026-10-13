/**
 * Import historischer Tageskurse aus CSV (z. B. Export aus Broker oder Datenportal).
 * Erkannte Spalten (Groß-/Kleinschreibung egal, DE/EN): Datum/Date, Eröffnung/Open, Hoch/High, Tief/Low,
 * Schluss/Schlusskurs/Close, Adj Close (optional), Volumen/Volume.
 * Herkunft wird als „csv:<Dateiname>“ gespeichert. Ungültige Zeilen werden gemeldet, nie geschätzt.
 */
import Papa from "papaparse";
import { parseDecimal, parseDateFlexible } from "./import";

export interface PriceCsvResult {
  bars: { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null }[];
  invalid: { line: number; reason: string }[];
  usedAdjusted: boolean;
  duplicates: number;
  columns: Record<string, string | null>;
}

const ALIASES: Record<string, string[]> = {
  date: ["date", "datum", "zeit", "time"],
  open: ["open", "eröffnung", "eroeffnung", "erster", "anfang"],
  high: ["high", "hoch"],
  low: ["low", "tief"],
  close: ["close", "schluss", "schlusskurs", "letzter", "kurs"],
  adj: ["adj close", "adj. close", "adjusted close", "bereinigt"],
  volume: ["volume", "volumen", "stück", "stueck"],
};

export function parsePriceCsv(text: string, opts: { useAdjusted?: boolean; today?: string } = {}): PriceCsvResult {
  const delimiter = (text.split("\n")[0] ?? "").includes(";") ? ";" : ",";
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, delimiter, transformHeader: (h) => h.trim().toLowerCase() });
  const fields = parsed.meta.fields ?? [];
  const find = (k: string) => fields.find((f) => ALIASES[k]!.includes(f)) ?? null;
  const columns = { date: find("date"), open: find("open"), high: find("high"), low: find("low"), close: find("close"), adj: find("adj"), volume: find("volume") };
  if (!columns.date || !(columns.close || columns.adj)) throw new Error(`Spalten Datum und Schlusskurs nicht erkannt (gefunden: ${fields.join(", ")})`);
  const useAdj = !!opts.useAdjusted && !!columns.adj;
  const closeCol = useAdj ? columns.adj! : columns.close ?? columns.adj!;
  const invalid: PriceCsvResult["invalid"] = [];
  const byDate = new Map<string, PriceCsvResult["bars"][number]>();
  let duplicates = 0;
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const date = parseDateFlexible(r[columns.date!]);
    const close = parseDecimal(r[closeCol]);
    if (!date) return void invalid.push({ line, reason: "Datum ungültig" });
    if (opts.today && date > opts.today) return void invalid.push({ line, reason: "Datum in der Zukunft" });
    if (close == null || close <= 0) return void invalid.push({ line, reason: "Schlusskurs fehlt oder ≤ 0" });
    const g = (c: string | null) => (c ? parseDecimal(r[c]) : null);
    let high = g(columns.high), low = g(columns.low);
    const open = g(columns.open);
    if (useAdj) { high = null; low = null; } // bereinigter Schluss passt nicht zu unbereinigtem Hoch/Tief
    if (high != null && low != null && high < low) return void invalid.push({ line, reason: "Hoch < Tief" });
    if (byDate.has(date)) duplicates++;
    byDate.set(date, { date, open: useAdj ? null : open, high, low, close, volume: g(columns.volume) });
  });
  for (const e of parsed.errors) invalid.push({ line: (e.row ?? 0) + 2, reason: `CSV-Fehler: ${e.message}` });
  return { bars: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)), invalid, usedAdjusted: useAdj, duplicates, columns };
}
