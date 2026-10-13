/**
 * CSV-Import von Transaktionen mit Vorschau und Zeilenvalidierung sowie Übernahme der
 * Sicherungsdatei des früheren Handelsbuchs (ehemals index.html, Format version 1).
 */
import Papa from "papaparse";
import { z } from "zod";
import { looksLikeSecretMaterial } from "../security/redact";

/** Deutsche und englische Zahlenschreibweise: "1.234,56" | "1,234.56" | "1234,5" | "1234.5" */
export function parseDecimal(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  let s = String(raw).trim().replace(/\s/g, "").replace(/[€$]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDateFlexible(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return isValidDate(s) ? s : null;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) { const iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`; return isValidDate(iso) ? iso : null; }
  return null;
}

function isValidDate(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const SIDE_MAP: Record<string, "BUY" | "SELL" | "DIVIDEND"> = {
  kauf: "BUY", buy: "BUY", k: "BUY",
  verkauf: "SELL", sell: "SELL", v: "SELL",
  dividende: "DIVIDEND", dividend: "DIVIDEND", ausschüttung: "DIVIDEND",
};
const TYPE_MAP: Record<string, "STOCK" | "ETF" | "CRYPTO" | "OTHER"> = {
  aktie: "STOCK", stock: "STOCK", etf: "ETF", krypto: "CRYPTO", crypto: "CRYPTO", sonstige: "OTHER", other: "OTHER",
};

export const ImportRowSchema = z.object({
  tradeDate: z.string(),
  side: z.enum(["BUY", "SELL", "DIVIDEND"]),
  symbol: z.string().min(1).max(20).regex(/^[A-Z0-9.\-:]+$/, "Symbol enthält ungültige Zeichen"),
  name: z.string().max(200),
  assetType: z.enum(["STOCK", "ETF", "CRYPTO", "OTHER"]),
  exchange: z.string().max(40).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Währung als ISO-Code (z. B. EUR, USD)"),
  quantity: z.number().positive("Menge muss > 0 sein"),
  price: z.number().nonnegative("Kurs darf nicht negativ sein"),
  fees: z.number().nonnegative("Gebühr darf nicht negativ sein"),
  feeCurrency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  fxToBase: z.number().positive().nullable(),
  note: z.string().max(2000).nullable(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export interface ImportPreview {
  valid: { line: number; row: ImportRow; warnings: string[] }[];
  invalid: { line: number; raw: Record<string, string>; errors: string[] }[];
  columns: string[];
}

export const CSV_TEMPLATE_HEADER = "datum;typ;symbol;name;assettyp;boerse;waehrung;menge;kurs;gebuehren;gebuehrenwaehrung;wechselkurs_zur_basis;notiz";

/** Erwartete Spalten (Groß-/Kleinschreibung egal), siehe CSV_TEMPLATE_HEADER. */
export function previewTransactionsCsv(text: string, baseCurrency = "EUR", today = new Date().toISOString().slice(0, 10)): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, delimiter: text.includes(";") ? ";" : ",", transformHeader: (h) => h.trim().toLowerCase() });
  const valid: ImportPreview["valid"] = [];
  const invalid: ImportPreview["invalid"] = [];
  parsed.data.forEach((raw, idx) => {
    const line = idx + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (Object.values(raw).some((v) => typeof v === "string" && looksLikeSecretMaterial(v))) {
      invalid.push({ line, raw: {}, errors: ["Zeile enthält etwas, das wie ein privater Schlüssel oder eine Seed-Phrase aussieht – nicht importiert und nicht gespeichert."] });
      return;
    }
    const tradeDate = parseDateFlexible(raw["datum"]);
    if (!tradeDate) errors.push("Datum ungültig (erwartet JJJJ-MM-TT oder TT.MM.JJJJ)");
    else if (tradeDate > today) errors.push("Datum liegt in der Zukunft");
    const side = SIDE_MAP[(raw["typ"] ?? "").trim().toLowerCase()];
    if (!side) errors.push("Typ unbekannt (Kauf, Verkauf, Dividende)");
    const assetType = TYPE_MAP[(raw["assettyp"] ?? "aktie").trim().toLowerCase()];
    if (!assetType) errors.push("Assettyp unbekannt (Aktie, ETF, Krypto, Sonstige)");
    const quantity = parseDecimal(raw["menge"]);
    const price = parseDecimal(raw["kurs"]);
    const fees = raw["gebuehren"]?.trim() ? parseDecimal(raw["gebuehren"]) : 0;
    const fxRaw = raw["wechselkurs_zur_basis"]?.trim();
    const fxToBase = fxRaw ? parseDecimal(fxRaw) : null;
    if (quantity == null) errors.push("Menge ist keine Zahl");
    if (price == null) errors.push("Kurs ist keine Zahl");
    if (fees == null) errors.push("Gebühr ist keine Zahl");
    if (fxRaw && fxToBase == null) errors.push("Wechselkurs ist keine Zahl");
    const currency = (raw["waehrung"] ?? "").trim().toUpperCase();
    const candidate = {
      tradeDate: tradeDate ?? "",
      side: side ?? "BUY",
      symbol: (raw["symbol"] ?? "").trim().toUpperCase(),
      name: (raw["name"] ?? "").trim(),
      assetType: assetType ?? "OTHER",
      exchange: raw["boerse"]?.trim() || null,
      currency,
      quantity: quantity ?? NaN,
      price: price ?? NaN,
      fees: fees ?? NaN,
      feeCurrency: raw["gebuehrenwaehrung"]?.trim().toUpperCase() || null,
      fxToBase,
      note: raw["notiz"]?.trim() || null,
    };
    const z = ImportRowSchema.safeParse(candidate);
    if (!z.success) for (const iss of z.error.issues) {
      const msg = `${iss.path.join(".")}: ${iss.message}`;
      if (!errors.some((e) => e.startsWith(iss.path.join(".")))) errors.push(msg);
    }
    if (errors.length) { invalid.push({ line, raw, errors: [...new Set(errors)] }); return; }
    const row = z.data!;
    if (row.currency !== baseCurrency && row.fxToBase == null) warnings.push(`Kein Wechselkurs ${row.currency}/${baseCurrency} – Einstand in ${baseCurrency} bleibt unbekannt, bis er ergänzt wird`);
    if (!row.name) warnings.push("Name fehlt – Symbol wird als Name verwendet");
    valid.push({ line, row, warnings });
  });
  for (const e of parsed.errors) invalid.push({ line: (e.row ?? 0) + 2, raw: {}, errors: [`CSV-Formatfehler: ${e.message}`] });
  return { valid, invalid, columns: parsed.meta.fields ?? [] };
}

// ---------- Sicherung des bisherigen Handelsbuchs ----------

const LegacySchema = z.object({
  version: z.number().optional(),
  assets: z.array(z.object({ id: z.string(), symbol: z.string(), name: z.string().optional().default(""), type: z.string(), price: z.number().nullable().optional() })),
  trades: z.array(z.object({ id: z.string(), assetId: z.string(), side: z.enum(["buy", "sell"]), date: z.string(), qty: z.number(), price: z.number(), fee: z.number().optional().default(0), note: z.string().optional().default(""), seq: z.number().optional() })),
  plans: z.array(z.object({ id: z.string(), symbol: z.string(), name: z.string().optional(), type: z.string(), entry: z.number().nullable().optional(), qtyPlan: z.number().nullable().optional(), stop: z.number().nullable().optional(), target: z.number().nullable().optional(), note: z.string().optional() }).passthrough()).optional().default([]),
});

export interface LegacyImport {
  instruments: { legacyId: string; symbol: string; name: string; assetType: "STOCK" | "CRYPTO"; manualPriceEur: number | null }[];
  transactions: { legacyId: string; legacyAssetId: string; side: "BUY" | "SELL"; tradeDate: string; quantity: number; price: number; fees: number; note: string | null; seq: number }[];
  plans: { symbol: string; name: string; assetType: "STOCK" | "CRYPTO"; entry: number | null; qty: number | null; note: string | null }[];
  warnings: string[];
}

/**
 * Das bisherige Handelsbuch rechnete ausschließlich in Euro (Kurse und Beträge in EUR).
 * Daher werden Buchungen mit Währung EUR und Wechselkurs 1 übernommen; Kurse aus der alten
 * Datei sind manuelle Eingaben und werden als solche gekennzeichnet.
 */
export function parseLegacyBackup(json: unknown): LegacyImport {
  const p = LegacySchema.safeParse(json);
  if (!p.success) throw new Error("Datei ist keine Sicherung des bisherigen Handelsbuchs (Format version 1).");
  const warnings: string[] = [];
  const ids = new Set(p.data.assets.map((a) => a.id));
  const tx = p.data.trades.filter((t) => {
    if (!ids.has(t.assetId)) { warnings.push(`Buchung ${t.id} ohne zugehörigen Wert übersprungen`); return false; }
    if (!parseDateFlexible(t.date)) { warnings.push(`Buchung ${t.id} mit ungültigem Datum übersprungen`); return false; }
    return true;
  });
  return {
    instruments: p.data.assets.map((a) => ({ legacyId: a.id, symbol: a.symbol.toUpperCase(), name: a.name || a.symbol, assetType: a.type === "crypto" ? "CRYPTO" : "STOCK", manualPriceEur: a.price ?? null })),
    transactions: tx.map((t) => ({ legacyId: t.id, legacyAssetId: t.assetId, side: t.side === "buy" ? "BUY" : "SELL", tradeDate: t.date, quantity: t.qty, price: t.price, fees: t.fee ?? 0, note: t.note || null, seq: t.seq ?? 0 })),
    plans: p.data.plans.map((pl) => ({ symbol: pl.symbol.toUpperCase(), name: pl.name ?? pl.symbol, assetType: pl.type === "crypto" ? "CRYPTO" : "STOCK", entry: pl.entry ?? null, qty: pl.qtyPlan ?? null, note: pl.note ?? null })),
    warnings,
  };
}
