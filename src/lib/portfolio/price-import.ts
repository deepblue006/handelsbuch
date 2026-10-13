/**
 * Import historischer Tageskurse aus CSV (z. B. Export aus Broker oder Datenportal).
 * Erkannte Spalten (Groß-/Kleinschreibung egal, DE/EN/PL): Datum/Date/Data, Eröffnung/Open, Hoch/High, Tief/Low,
 * Schluss/Schlusskurs/Close/Close/Last (Nasdaq.com), Adj Close (optional), Volumen/Volume.
 * Datumsformate: JJJJ-MM-TT, TT.MM.JJJJ und mit Schrägstrich (MM/TT/JJJJ wie bei Nasdaq.com oder TT/MM/JJJJ) –
 * die Reihenfolge wird aus den Daten erkannt (Wert > 12); ist sie nicht eindeutig, wird der Import abgelehnt.
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
  date: ["date", "datum", "zeit", "time", "data"],
  open: ["open", "eröffnung", "eroeffnung", "erster", "anfang", "otwarcie"],
  high: ["high", "hoch", "najwyzszy", "najwyższy"],
  low: ["low", "tief", "najnizszy", "najniższy"],
  close: ["close", "close/last", "schluss", "schlusskurs", "letzter", "kurs", "zamkniecie", "zamknięcie"],
  adj: ["adj close", "adj. close", "adjusted close", "bereinigt"],
  volume: ["volume", "volumen", "stück", "stueck", "wolumen"],
};

export function parsePriceCsv(text: string, opts: { useAdjusted?: boolean; today?: string } = {}): PriceCsvResult {
  const delimiter = (text.split("\n")[0] ?? "").includes(";") ? ";" : ",";
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, delimiter, transformHeader: (h) => h.trim().toLowerCase() });
  const fields = parsed.meta.fields ?? [];
  const find = (k: string) => fields.find((f) => ALIASES[k]!.includes(f)) ?? null;
  const columns = { date: find("date"), open: find("open"), high: find("high"), low: find("low"), close: find("close"), adj: find("adj"), volume: find("volume") };
  if (!columns.date || !(columns.close || columns.adj)) throw new Error(`Spalten Datum und Schlusskurs nicht erkannt (gefunden: ${fields.join(", ")})`);
  const useAdj = !!opts.useAdjusted && !!columns.adj;
  const slashOrder = detectSlashOrder(parsed.data.map((r) => String(r[columns.date!] ?? "")));
  const toIso = (raw: unknown) => parseDateFlexible(raw) ?? parseSlashDate(String(raw ?? "").trim(), slashOrder);
  const closeCol = useAdj ? columns.adj! : columns.close ?? columns.adj!;
  const invalid: PriceCsvResult["invalid"] = [];
  const byDate = new Map<string, PriceCsvResult["bars"][number]>();
  let duplicates = 0;
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const date = toIso(r[columns.date!]);
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

const SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Reihenfolge bei Schrägstrich-Daten: MDY (US, Nasdaq.com) oder DMY – nur wenn aus den Daten eindeutig. */
export function detectSlashOrder(values: string[]): "MDY" | "DMY" | null {
  let firstOver12 = false, secondOver12 = false, any = false;
  for (const v of values) {
    const m = SLASH.exec(v.trim());
    if (!m) continue;
    any = true;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  if (!any) return null;
  if (firstOver12 && secondOver12) throw new Error("Datumsspalte uneinheitlich (Tag und Monat vertauscht?)");
  if (firstOver12) return "DMY";
  if (secondOver12) return "MDY";
  throw new Error("Datumsformat mit Schrägstrich nicht eindeutig (TT/MM oder MM/TT) – bitte JJJJ-MM-TT verwenden oder mehr Zeilen exportieren");
}

function parseSlashDate(s: string, order: "MDY" | "DMY" | null): string | null {
  const m = SLASH.exec(s);
  if (!m || !order) return null;
  const [mm, dd] = order === "MDY" ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
  const iso = `${m[3]}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  const d = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
