/**
 * US-Politiker-Transaktionsradar – Normalisierung, Plausibilisierung, Deduplizierung, Korrekturen.
 *
 * Grundsätze:
 * - Transaktions-, Benachrichtigungs-, Einreichungs- und Veröffentlichungsdatum bleiben getrennt.
 * - Beträge sind Spannen; es wird nie ein exakter Betrag behauptet.
 * - Eigentümerzuordnung genau wie im Dokument (SELF/SPOUSE/JOINT/DEPENDENT_CHILD) oder UNBEKANNT.
 * - Automatische Plausibilisierung ≠ manuelle Prüfung.
 * - Meldungen sind Kontextinformationen; es werden keine Motive unterstellt.
 */
import { createHash } from "node:crypto";
import type { AvCongressTrade } from "../providers/alphavantage";

export const RECORD_STATUS = {
  OFFIZIELLE_QUELLE_GEFUNDEN: "Offizielle Quelle gefunden",
  AUTOMATISCH_EXTRAHIERT: "Automatisch extrahiert",
  AUTOMATISCH_PLAUSIBILISIERT: "Automatisch auf Plausibilität geprüft",
  MANUELL_GEPRUEFT: "Manuell geprüft",
  KORRIGIERT_ODER_ERSETZT: "Korrigiert oder ersetzt",
  UNVOLLSTAENDIG: "Unvollständig",
  NICHT_EINDEUTIG: "Nicht eindeutig zuordenbar",
  SEKUNDAERQUELLE: "Sekundärquelle – Originaldokument nicht geprüft",
} as const;
export type RecordStatus = keyof typeof RECORD_STATUS;

export type Owner = "SELF" | "SPOUSE" | "JOINT" | "DEPENDENT_CHILD" | "UNBEKANNT";
export type InstrumentKind = "AKTIE" | "OPTION" | "ANLEIHE" | "FONDS" | "KRYPTO" | "SONSTIGE" | "UNBEKANNT";
export type TxType = "KAUF" | "VERKAUF" | "TEILVERKAUF" | "TAUSCH" | "SONSTIGE";

export interface NormTx {
  source: string;
  politicianName: string;
  bioguideId: string | null;
  chamber: "HOUSE" | "SENATE" | "EXECUTIVE";
  party: string | null;
  state: string | null;
  owner: Owner;
  assetName: string;
  ticker: string | null;
  tickerSource: string | null;
  instrumentKind: InstrumentKind;
  txType: TxType;
  transactionDate: string | null;
  notificationDate: string | null;
  filedDate: string | null;
  publishedDate: string | null; // nur wenn die Quelle ein Veröffentlichungsdatum liefert
  amountMin: number | null;
  amountMax: number | null;
  amountText: string | null;
  sourceFilingStatus: string | null; // NEW | AMENDED | DELETED | null
  rawText: string | null;
  uncertaintyFlags: string[];
  extractionConfidence: number | null;
  /** n-tes Vorkommen einer vollständig identischen Zeile derselben Meldung (1 = einzig/erstes). */
  occurrence?: number;
}

/** Offizielle Betragsspannen der Formulare (STOCK Act / Ethics in Government Act). */
export const OFFICIAL_RANGES: [number, number | null][] = [
  [1001, 15000], [15001, 50000], [50001, 100000], [100001, 250000], [250001, 500000],
  [500001, 1000000], [1000001, 5000000], [5000001, 25000000], [25000001, 50000000], [50000001, null],
];

const isoOrNull = (s: string | null | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function mapOwner(code: string | null | undefined): Owner {
  const c = (code ?? "").trim().toUpperCase();
  if (c === "SELF" || c === "") return code == null || c === "" ? "UNBEKANNT" : "SELF";
  if (c === "SPOUSE" || c === "SP") return "SPOUSE";
  if (c === "JOINT" || c === "JT") return "JOINT";
  if (c === "DEPENDENT_CHILD" || c === "DC" || c === "CHILD") return "DEPENDENT_CHILD";
  return "UNBEKANNT";
}

export function mapInstrumentKind(code: string | null | undefined): { kind: InstrumentKind; flag?: string } {
  if (code == null || code === "") return { kind: "UNBEKANNT", flag: "Asset-Typ nicht gemeldet" };
  const raw = code.trim();
  const c = raw.toUpperCase();
  let kind: InstrumentKind;
  if (c === "ST" || c === "STOCK" || c === "CS") kind = "AKTIE";
  else if (c === "OP" || c === "STOCK OPTION" || c === "OPTION") kind = "OPTION";
  else if (c === "GS" || c === "CT" || c === "BOND" || c === "MUNI") kind = "ANLEIHE";
  else if (c === "EF" || c === "MF" || c === "ETF" || c === "FUND") kind = "FONDS";
  else if (c === "CRP" || c === "CRYPTO") kind = "KRYPTO";
  else kind = "SONSTIGE";
  const standard = ["ST", "OP", "GS", "CT", "EF", "MF", "CS", "Stock", "Stock Option"];
  return { kind, flag: standard.includes(raw) ? undefined : `Asset-Code uneinheitlich gemeldet („${raw}“)` };
}

export function mapTxType(t: string | null | undefined): TxType {
  const c = (t ?? "").trim().toUpperCase();
  if (c === "BUY" || c === "P" || c === "PURCHASE") return "KAUF";
  if (c === "SELL" || c === "S" || c === "SALE" || c === "SALE (FULL)") return "VERKAUF";
  if (c === "S (PARTIAL)" || c === "SALE (PARTIAL)" || c === "PARTIAL_SALE") return "TEILVERKAUF";
  if (c === "E" || c === "EXCHANGE") return "TAUSCH";
  return "SONSTIGE";
}

export function fromAlphaVantage(t: AvCongressTrade): NormTx {
  const flags: string[] = [];
  const kind = mapInstrumentKind(t.asset_type_code);
  if (kind.flag) flags.push(kind.flag);
  const ticker = (t.symbol || t.ticker_reported || "").trim().toUpperCase() || null;
  if (!ticker) flags.push("Ticker fehlt – Zuordnung zum Wertpapier unsicher");
  if (t.ticker_source && t.ticker_source !== "reported") flags.push(`Ticker nicht gemeldet, sondern abgeleitet (${t.ticker_source})`);
  if (/FILING STATUS|SUBHOLDING OF|DESCRIPTION:/i.test(t.asset_name)) flags.push("Asset-Bezeichnung enthält Formulartext – Extraktion der Quelle vermutlich fehlerhaft");
  const min = t.amount_min != null ? Number(t.amount_min) : null;
  const max = t.amount_max != null ? Number(t.amount_max) : null;
  return {
    source: "ALPHAVANTAGE_SECONDARY",
    politicianName: t.politician_canonical || t.politician,
    bioguideId: t.bioguide_id || null,
    chamber: t.chamber.toUpperCase() === "SENATE" ? "SENATE" : "HOUSE",
    party: t.party ?? null,
    state: t.state_district || t.state || null,
    owner: mapOwner(t.owner_code),
    assetName: t.asset_name,
    ticker,
    tickerSource: t.ticker_source ?? null,
    instrumentKind: kind.kind,
    txType: mapTxType(t.transaction_type),
    transactionDate: isoOrNull(t.transaction_date),
    notificationDate: isoOrNull(t.notification_date),
    filedDate: isoOrNull(t.filed_date),
    publishedDate: null, // Alpha Vantage liefert kein Veröffentlichungsdatum
    amountMin: Number.isFinite(min) ? min : null,
    amountMax: Number.isFinite(max) ? max : null,
    amountText: min != null || max != null ? `${min ?? "?"} – ${max ?? "?"} USD (Spanne)` : null,
    sourceFilingStatus: t.filing_status ?? null,
    rawText: null,
    uncertaintyFlags: flags,
    extractionConfidence: null,
  };
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export interface PlausibilityResult {
  ok: boolean;
  hardErrors: string[];
  warnings: string[];
}

/** Automatische Plausibilitätsprüfung (ersetzt keine manuelle Prüfung). */
export function checkPlausibility(t: NormTx, today: string): PlausibilityResult {
  const hard: string[] = [];
  const warn: string[] = [];
  if (!t.transactionDate) hard.push("Transaktionsdatum fehlt");
  if (!t.assetName) hard.push("Vermögenswert fehlt");
  if (t.amountMin == null && t.amountMax == null) hard.push("Betragsspanne fehlt");
  if (t.amountMin != null && t.amountMax != null && t.amountMin > t.amountMax) hard.push("Betragsspanne: Minimum > Maximum");
  if (t.amountMin != null) {
    const match = OFFICIAL_RANGES.some(([lo, hi]) => lo === t.amountMin && (hi === t.amountMax || (hi === null && t.amountMax == null)));
    if (!match) warn.push("Betragsspanne entspricht keiner offiziellen Formularspanne");
  }
  if (t.transactionDate && t.transactionDate > today) hard.push("Transaktionsdatum liegt in der Zukunft");
  if (t.transactionDate && t.filedDate) {
    if (t.filedDate < t.transactionDate) hard.push("Einreichung vor Transaktion");
    else {
      const d = daysBetween(t.transactionDate, t.filedDate);
      if (d > 45) warn.push(`Einreichung ${d} Tage nach Transaktion (gesetzliche Frist i. d. R. 45 Tage; Datumsfelder prüfen – keine Wertung)`);
    }
  }
  if (t.notificationDate && t.transactionDate && t.notificationDate < t.transactionDate) warn.push("Benachrichtigung vor Transaktion");
  if (t.owner === "UNBEKANNT") warn.push("Eigentümer nicht angegeben");
  return { ok: hard.length === 0, hardErrors: hard, warnings: warn };
}

export function statusFor(t: NormTx, p: PlausibilityResult): { status: RecordStatus; needsReview: boolean } {
  if (t.source === "ALPHAVANTAGE_SECONDARY") return { status: "SEKUNDAERQUELLE", needsReview: !p.ok || t.uncertaintyFlags.some((f) => f.includes("identische Zeilen")) };
  if (!p.ok) return { status: "UNVOLLSTAENDIG", needsReview: true };
  if (!t.ticker || (t.extractionConfidence != null && t.extractionConfidence < 0.8)) return { status: "NICHT_EINDEUTIG", needsReview: true };
  if ((t.occurrence ?? 1) > 1) return { status: "NICHT_EINDEUTIG", needsReview: true };
  return { status: "AUTOMATISCH_PLAUSIBILISIERT", needsReview: t.uncertaintyFlags.length > 0 };
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Korrekturschlüssel: Person, Vermögenswert, Transaktionsdatum, Eigentümer – OHNE Typ und Betrag,
 * denn echte Korrekturen ändern genau diese Felder (z. B. „OTHER“ → „SELL“, andere Betragsspanne).
 */
export function correctionKey(t: NormTx): string {
  const who = t.bioguideId || norm(t.politicianName);
  const what = t.ticker || norm(t.assetName);
  return [t.chamber, who, what, t.transactionDate ?? "", t.owner].join("|");
}

/** Identitätsschlüssel inkl. Typ und Betragsspanne – erkennt exakte Doppelmeldungen. */
export function dedupeKey(t: NormTx): string {
  const occ = t.occurrence && t.occurrence > 1 ? `#${t.occurrence}` : "";
  return createHash("sha256").update([correctionKey(t), t.txType, t.amountMin ?? "", t.amountMax ?? ""].join("|") + occ).digest("hex").slice(0, 32);
}

/**
 * Vollständig identische Zeilen innerhalb einer Lieferung (gleiche Person, Wert, Datum, Typ, Spanne,
 * Einreichung) können mehrere echte Transaktionen ODER eine Doppelung sein. Sie werden nicht verworfen,
 * sondern nummeriert, markiert und zur manuellen Prüfung vorgelegt.
 */
export function assignOccurrences(rows: NormTx[]): NormTx[] {
  const groups = new Map<string, NormTx[]>();
  for (const r of rows) {
    const k = `${dedupeKey({ ...r, occurrence: 1 })}|${r.filedDate}|${r.sourceFilingStatus ?? "NEW"}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: NormTx[] = [];
  for (const g of groups.values()) {
    g.forEach((r, i) => out.push({
      ...r,
      occurrence: i + 1,
      uncertaintyFlags: g.length > 1 ? [...r.uncertaintyFlags, `${g.length} identische Zeilen in derselben Meldung (Nr. ${i + 1}) – mehrere Transaktionen oder Doppelung; Originaldokument prüfen`] : r.uncertaintyFlags,
    }));
  }
  return out;
}

export interface StoredTx {
  id: string;
  dedupeKey: string;
  correctionKey: string;
  txType: string;
  amountMin: number | null;
  amountMax: number | null;
  version: number;
  isCurrent: boolean;
  filedDate: string | null;
}

export interface ReconcileAction {
  kind: "INSERT" | "DUPLICATE" | "SUPERSEDE" | "DELETE_MARK" | "REVIEW";
  incoming: NormTx;
  dedupeKey: string;
  targets: string[]; // betroffene bestehende IDs
  version: number;
  reason: string;
}

/** Grenzt Kandidaten schrittweise ein: erst gleiche Betragsspanne, dann gleicher Typ. */
function narrow(cands: StoredTx[], t: NormTx): StoredTx[] {
  if (cands.length <= 1) return cands;
  const byAmount = cands.filter((c) => c.amountMin === t.amountMin && c.amountMax === t.amountMax);
  if (byAmount.length === 1) return byAmount;
  const pool = byAmount.length ? byAmount : cands;
  const byType = pool.filter((c) => c.txType === t.txType);
  return byType.length === 1 ? byType : pool;
}

/**
 * Gleicht eingehende Meldungen mit dem Bestand ab. Neue Meldungen sollten vor Korrekturen
 * verarbeitet werden (siehe orderForIngest).
 * - Gleicher Identitätsschlüssel → Duplikat
 * - AMENDED → ersetzt genau eine passende frühere Meldung; mehrdeutig → manuelle Prüfung;
 *   ohne Original → neu gespeichert und zur Prüfung markiert
 * - DELETED → markiert passende Meldung als ersetzt; ohne eindeutigen Treffer → manuelle Prüfung
 */
export function reconcile(existing: StoredTx[], incoming: NormTx[]): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  const current = existing.filter((e) => e.isCurrent);
  const seen = new Set<string>();
  for (const t of incoming) {
    const dk = dedupeKey(t);
    const ck = correctionKey(t);
    const st = (t.sourceFilingStatus ?? "NEW").toUpperCase();
    const seenKey = `${dk}|${t.filedDate}|${st}`;
    if (seen.has(seenKey)) { actions.push({ kind: "DUPLICATE", incoming: t, dedupeKey: dk, targets: [], version: 0, reason: "Doppelte Zeile in derselben Lieferung" }); continue; }
    seen.add(seenKey);
    const earlier = current.filter((e) => e.correctionKey === ck && (!t.filedDate || !e.filedDate || e.filedDate <= t.filedDate));
    if (st === "DELETED") {
      // Löschungen nur bei exakter Betragsübereinstimmung zuordnen
      const exactAmt = (e: StoredTx) => e.amountMin === t.amountMin && e.amountMax === t.amountMax;
      const already = existing.filter((e) => !e.isCurrent && e.correctionKey === ck && exactAmt(e));
      const c = earlier.filter(exactAmt);
      const pick = c.length > 1 ? c.filter((e) => e.txType === t.txType) : c;
      if (pick.length === 1) actions.push({ kind: "DELETE_MARK", incoming: t, dedupeKey: dk, targets: [pick[0]!.id], version: pick[0]!.version + 1, reason: "Quelle meldet Löschung" });
      else if (pick.length === 0 && already.length) actions.push({ kind: "DUPLICATE", incoming: t, dedupeKey: dk, targets: already.map((a) => a.id), version: 0, reason: "Löschung bereits verarbeitet" });
      else actions.push({ kind: "REVIEW", incoming: t, dedupeKey: dk, targets: pick.map((x) => x.id), version: 1, reason: pick.length ? "Löschung nicht eindeutig zuordenbar" : "Löschung ohne passende Originalmeldung" });
      continue;
    }
    // Identitätsprüfung gegen ALLE Fassungen (auch ersetzte), damit erneute Lieferungen keine Dubletten erzeugen
    const exact = existing.find((e) => (e.dedupeKey === dk || e.dedupeKey === `${dk}@${t.filedDate ?? "?"}`) && e.filedDate === t.filedDate);
    if (exact) { actions.push({ kind: "DUPLICATE", incoming: t, dedupeKey: dk, targets: [exact.id], version: exact.version, reason: "Bereits erfasst" }); continue; }
    if (st === "AMENDED") {
      const c = narrow(earlier.filter((e) => e.filedDate !== t.filedDate), t);
      if (c.length === 1) actions.push({ kind: "SUPERSEDE", incoming: t, dedupeKey: dk, targets: [c[0]!.id], version: c[0]!.version + 1, reason: "Korrigierte Meldung ersetzt frühere Fassung" });
      else if (c.length === 0) actions.push({ kind: "INSERT", incoming: t, dedupeKey: dk, targets: [], version: 1, reason: "Korrektur ohne bekannte Originalfassung – neu gespeichert, Prüfung empfohlen" });
      else actions.push({ kind: "REVIEW", incoming: t, dedupeKey: dk, targets: c.map((x) => x.id), version: 1, reason: "Korrektur passt zu mehreren Meldungen" });
      continue;
    }
    const sameIdentity = current.find((e) => e.dedupeKey === dk);
    if (sameIdentity) { actions.push({ kind: "REVIEW", incoming: t, dedupeKey: `${dk}@${t.filedDate ?? "?"}`, targets: [sameIdentity.id], version: 1, reason: `Gleiche Transaktion bereits mit Einreichung vom ${sameIdentity.filedDate ?? "?"} erfasst – Nachmeldung oder Doppelung? Originaldokumente prüfen` }); continue; }
    actions.push({ kind: "INSERT", incoming: t, dedupeKey: dk, targets: [], version: 1, reason: "Neue Meldung" });
  }
  return actions;
}

/** Reihenfolge für die Verarbeitung: neue Meldungen (nach Einreichung) vor Korrekturen und Löschungen. */
export function orderForIngest(rows: NormTx[]): NormTx[] {
  const rank = (t: NormTx) => { const s = (t.sourceFilingStatus ?? "NEW").toUpperCase(); return s === "AMENDED" ? 1 : s === "DELETED" ? 2 : 0; };
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.filedDate ?? "").localeCompare(b.filedDate ?? "") || (a.occurrence ?? 1) - (b.occurrence ?? 1));
}

/** Wendet Aktionen auf einen In-Memory-Bestand an (gleiche Logik wie die Datenbankschicht). */
export function applyActions(store: StoredTx[], actions: ReconcileAction[], newId: () => string): StoredTx[] {
  const out = store.map((s) => ({ ...s }));
  for (const a of actions) {
    if (a.kind === "DUPLICATE") continue;
    if (a.kind === "SUPERSEDE" || a.kind === "DELETE_MARK") for (const id of a.targets) { const s = out.find((x) => x.id === id); if (s) s.isCurrent = false; }
    if (a.kind === "DELETE_MARK") continue;
    out.push({ id: newId(), dedupeKey: a.dedupeKey, correctionKey: correctionKey(a.incoming), txType: a.incoming.txType, amountMin: a.incoming.amountMin, amountMax: a.incoming.amountMax, version: a.version, isCurrent: true, filedDate: a.incoming.filedDate });
  }
  return out;
}

// ============================== House Clerk ==============================

export interface HouseFilingIndexEntry {
  docId: string;
  filerName: string;
  stateDistrict: string | null;
  filingTypeCode: string;
  filingType: "PTR" | "ANNUAL" | "AMENDMENT" | "UNKNOWN";
  filedDate: string | null;
  year: number | null;
  pdfUrl: string;
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export function usDateToIso(s: string | null | undefined): string | null {
  const m = (s ?? "").trim().match(US_DATE);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

/**
 * Parst die Jahresindexdatei (YYYYFD.xml) aus dem offiziellen ZIP-Archiv des House Clerk.
 * Erwartete Struktur: <FinancialDisclosure><Member><Prefix/><Last/><First/><Suffix/><FilingType/>
 * <StateDst/><Year/><FilingDate/><DocID/></Member>…  (Format nicht live verifiziert)
 */
export async function parseHouseIndexXml(xml: string): Promise<HouseFilingIndexEntry[]> {
  const { XMLParser } = await import("fast-xml-parser");
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, processEntities: false, isArray: (name) => name === "Member" });
  const doc = parser.parse(xml) as { FinancialDisclosure?: { Member?: Record<string, string>[] } };
  const members = doc.FinancialDisclosure?.Member ?? [];
  return members
    .filter((m) => m.DocID)
    .map((m) => {
      const code = String(m.FilingType ?? "").trim().toUpperCase();
      const year = Number(m.Year) || null;
      const filingType = code === "P" ? "PTR" : code === "O" ? "ANNUAL" : code === "A" ? "AMENDMENT" : "UNKNOWN";
      const name = [m.Prefix, m.First, m.Last, m.Suffix].filter((x) => x && String(x).trim()).join(" ").replace(/\s+/g, " ").trim();
      const folder = filingType === "PTR" ? "ptr-pdfs" : "financial-pdfs";
      return {
        docId: String(m.DocID).trim(),
        filerName: name,
        stateDistrict: m.StateDst ? String(m.StateDst) : null,
        filingTypeCode: code,
        filingType,
        filedDate: usDateToIso(m.FilingDate),
        year,
        pdfUrl: `https://disclosures-clerk.house.gov/public_disc/${folder}/${year}/${String(m.DocID).trim()}.pdf`,
      };
    });
}

/**
 * Extrahiert Transaktionszeilen aus dem TEXT einer elektronisch eingereichten House-PTR
 * (vom Nutzer aus dem Original-PDF kopiert oder per PDF-Textextraktion gewonnen).
 * Erwartetes Zeilenmuster: [Owner] Asset (TICKER) [TYP] P|S|S (partial)|E MM/DD/YYYY MM/DD/YYYY $min - $max
 * Nicht gegen echte Dokumente verifiziert – jedes Ergebnis erhält Konfidenz und Prüf-Flags.
 */
export function parsePtrText(text: string, meta: { politicianName: string; chamber: "HOUSE" | "SENATE"; filedDate: string | null; state: string | null }): NormTx[] {
  const flat = text.replace(/\r/g, "").replace(/\n+/g, " ").replace(/\s+/g, " ");
  const re = /\s*(?:\b(SP|JT|DC)\s+)?([^$]{3,200}?)\s+(P|S \(partial\)|S|E)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+)/g;
  const out: NormTx[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const [, ownerCode, assetRaw, type, d1, d2, amount] = m;
    const flags: string[] = ["Aus Dokumenttext extrahiert – Abgleich mit Original-PDF erforderlich"];
    let confidence = 0.9;
    const asset = assetRaw!.replace(/^(ID Owner Asset Transaction Type Date Notification Date Amount Cap\. Gains > \$200\?)\s*/i, "").trim();
    const tick = asset.match(/\(([A-Z.]{1,6})\)/);
    const typeTag = asset.match(/\[([A-Za-z]{2,3})\]/);
    if (!tick) { flags.push("Kein Ticker im Text"); confidence -= 0.2; }
    if (!typeTag) { flags.push("Kein Asset-Typ-Kürzel im Text"); confidence -= 0.1; }
    if (asset.length > 120) { flags.push("Ungewöhnlich lange Asset-Bezeichnung – Zeilenumbruch fehlerhaft?"); confidence -= 0.2; }
    let min: number | null = null, max: number | null = null;
    if (amount!.startsWith("Over")) min = Number(amount!.replace(/[^\d]/g, "")) + 1;
    else {
      const parts = amount!.split("-").map((p) => Number(p.replace(/[^\d]/g, "")));
      min = parts[0] ?? null; max = parts[1] ?? null;
    }
    const kind = mapInstrumentKind(typeTag?.[1] ?? null);
    if (kind.flag && typeTag) flags.push(kind.flag);
    out.push({
      source: meta.chamber === "HOUSE" ? "HOUSE_CLERK" : "SENATE_EFD",
      politicianName: meta.politicianName,
      bioguideId: null,
      chamber: meta.chamber,
      party: null,
      state: meta.state,
      owner: ownerCode ? mapOwner(ownerCode) : "SELF",
      assetName: asset,
      ticker: tick?.[1] ?? null,
      tickerSource: tick ? "gemeldet" : null,
      instrumentKind: kind.kind,
      txType: mapTxType(type),
      transactionDate: usDateToIso(d1),
      notificationDate: usDateToIso(d2),
      filedDate: meta.filedDate,
      publishedDate: null,
      amountMin: min,
      amountMax: max,
      amountText: amount!,
      sourceFilingStatus: "NEW",
      rawText: m[0],
      uncertaintyFlags: ownerCode ? flags : [...flags, "Kein Eigentümerkürzel – im Formular bedeutet leer i. d. R. „Filer“; bitte prüfen"],
      extractionConfidence: Math.max(0, Math.min(1, confidence)),
    });
  }
  return out;
}
