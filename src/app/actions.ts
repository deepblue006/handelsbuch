"use server";
/**
 * Server-Aktionen. Alle Eingaben werden validiert; es werden keine Broker-Zugänge,
 * Seed-Phrasen oder privaten Schlüssel angenommen. Keine Aktion löst eine Order aus.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AssetType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { previewTransactionsCsv, parseLegacyBackup, parseDecimal, parseDateFlexible, type ImportPreview } from "@/lib/portfolio/import";
import { looksLikeSecretMaterial } from "@/lib/security/redact";
import { saveSetting, getGeneral, todayIso } from "@/lib/settings";
import { ValuationAssumptionsSchema } from "@/lib/server/analysis";
import { refreshAll } from "@/lib/server/refresh";
import { parseWideFlowTable } from "@/lib/flows/flows";
import { upsertFlows, ingestPoliticianTx } from "@/lib/server/ingest";
import { parsePtrText } from "@/lib/politics/normalize";
import { PROVIDERS } from "@/lib/providers/registry";

export type ActionState = { ok: boolean; message: string; preview?: ImportPreview | null } | null;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (f: FormData, k: string) => { const v = str(f, k); return v ? parseDecimal(v) : null; };
function rejectSecrets(...vals: string[]) {
  if (vals.some((v) => looksLikeSecretMaterial(v))) throw new Error("Eingabe sieht wie ein privater Schlüssel oder eine Seed-Phrase aus und wird nicht gespeichert.");
}
function fail(e: unknown): ActionState {
  return { ok: false, message: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (e as Error).message };
}

const InstrumentInput = z.object({
  symbol: z.string().min(1).max(20).regex(/^[A-Z0-9.\-:]+$/, "Symbol: nur A–Z, 0–9, . - :"),
  name: z.string().max(200),
  assetType: z.enum(["STOCK", "ETF", "CRYPTO", "OTHER"]),
  currency: z.string().regex(/^[A-Z]{3}$/, "Währung als ISO-Code"),
  exchange: z.string().max(40).nullable(),
});

async function upsertInstrument(i: z.infer<typeof InstrumentInput>, extra: Partial<{ onWatchlist: boolean; sector: string | null; coingeckoId: string | null }> = {}) {
  const ex = await prisma.instrument.findUnique({ where: { symbol: i.symbol } });
  if (ex) {
    if (extra.onWatchlist) await prisma.instrument.update({ where: { id: ex.id }, data: { onWatchlist: true } });
    return ex;
  }
  return prisma.instrument.create({ data: { symbol: i.symbol, name: i.name || i.symbol, assetType: i.assetType as AssetType, currency: i.currency, exchange: i.exchange, onWatchlist: extra.onWatchlist ?? false, sector: extra.sector ?? null, providerIds: extra.coingeckoId ? { coingecko: extra.coingeckoId } : {} } });
}

export async function addTransaction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    rejectSecrets(str(f, "note"), str(f, "name"));
    const inst = InstrumentInput.parse({ symbol: str(f, "symbol").toUpperCase(), name: str(f, "name"), assetType: str(f, "assetType"), currency: str(f, "currency").toUpperCase(), exchange: str(f, "exchange") || null });
    const date = parseDateFlexible(str(f, "tradeDate"));
    if (!date) throw new Error("Datum ungültig");
    if (date > todayIso()) throw new Error("Datum liegt in der Zukunft");
    const side = z.enum(["BUY", "SELL", "DIVIDEND"]).parse(str(f, "side"));
    const quantity = numOrNull(f, "quantity");
    const price = numOrNull(f, "price");
    if (!(quantity && quantity > 0)) throw new Error("Menge muss > 0 sein");
    if (price == null || price < 0) throw new Error("Kurs ungültig");
    const fees = numOrNull(f, "fees") ?? 0;
    if (fees < 0) throw new Error("Gebühr ungültig");
    const fx = numOrNull(f, "fxToBase");
    const general = await getGeneral();
    if (inst.currency !== general.baseCurrency && fx == null) {
      // erlaubt, aber Einstand in Basiswährung bleibt unbekannt (wird im Portfolio angezeigt)
    }
    const i = await upsertInstrument(inst);
    if (i.currency !== inst.currency) throw new Error(`${i.symbol} ist bereits mit Handelswährung ${i.currency} angelegt`);
    if (side === "SELL") {
      const txs = await prisma.transaction.findMany({ where: { instrumentId: i.id, tradeDate: { lte: new Date(date + "T00:00:00Z") } } });
      const held = txs.reduce((s, t) => s + (t.side === "BUY" ? t.quantity : t.side === "SELL" ? -t.quantity : 0), 0);
      if (quantity > held + 1e-9) throw new Error(`Bestand am ${date}: ${held} – Verkauf von ${quantity} nicht möglich`);
    }
    const feeCurrency = str(f, "feeCurrency").toUpperCase() || inst.currency;
    const tx = await prisma.transaction.create({ data: { instrumentId: i.id, side, tradeDate: new Date(date + "T00:00:00Z"), quantity, price, priceCurrency: inst.currency, fees, feeCurrency, fxToBase: inst.currency === general.baseCurrency ? 1 : fx, fxSource: fx != null ? "manuell" : null, note: str(f, "note") || null, seq: Date.now() % 2_000_000_000 } });
    if (str(f, "adjustCash") === "on") {
      // Liquidität in Handelswährung buchen; Gebühr in eigener Währung separat, damit nichts umgerechnet werden muss
      const gross = side === "DIVIDEND" ? quantity * price : quantity * price;
      const day = new Date(date + "T00:00:00Z");
      const ref = `Buchung ${tx.id.slice(-6)} (${side} ${i.symbol})`;
      await prisma.cashMovement.create({ data: { date: day, type: side === "BUY" ? "WITHDRAWAL" : "DEPOSIT", amount: gross, currency: inst.currency, note: ref } });
      if (fees > 0) await prisma.cashMovement.create({ data: { date: day, type: "WITHDRAWAL", amount: fees, currency: feeCurrency, note: `${ref} – Gebühr` } });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `${side === "BUY" ? "Kauf" : side === "SELL" ? "Verkauf" : "Dividende"} ${i.symbol} gebucht.` };
  } catch (e) { return fail(e); }
}

export async function deleteTransaction(f: FormData) {
  const id = str(f, "id");
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/", "layout");
}

export async function previewCsv(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const text = str(f, "csv");
    if (text.length > 1_000_000) throw new Error("Datei zu groß (max. 1 MB)");
    const general = await getGeneral();
    const p = previewTransactionsCsv(text, general.baseCurrency, todayIso(general.timezone));
    if (str(f, "commit") !== "1") return { ok: true, message: `${p.valid.length} gültige, ${p.invalid.length} ungültige Zeilen – bitte prüfen und bestätigen.`, preview: p };
    if (!p.valid.length) throw new Error("Keine gültigen Zeilen");
    const batch = await prisma.importBatch.create({ data: { kind: "CSV_TRANSACTIONS", filename: str(f, "filename") || null, rowsTotal: p.valid.length + p.invalid.length, accepted: p.valid.length, rejected: p.invalid.length } });
    for (const v of p.valid) {
      const r = v.row;
      const i = await upsertInstrument({ symbol: r.symbol, name: r.name, assetType: r.assetType, currency: r.currency, exchange: r.exchange });
      await prisma.transaction.create({ data: { instrumentId: i.id, side: r.side, tradeDate: new Date(r.tradeDate + "T00:00:00Z"), quantity: r.quantity, price: r.price, priceCurrency: r.currency, fees: r.fees, feeCurrency: r.feeCurrency ?? r.currency, fxToBase: r.currency === general.baseCurrency ? 1 : r.fxToBase, fxSource: r.fxToBase != null ? "CSV-Import" : null, note: r.note, importBatchId: batch.id, seq: v.line } });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `${p.valid.length} Buchungen importiert, ${p.invalid.length} Zeilen verworfen (Import-ID ${batch.id}).`, preview: null };
  } catch (e) { return fail(e); }
}

export async function importLegacy(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const text = str(f, "json");
    if (text.length > 5_000_000) throw new Error("Datei zu groß");
    const data = parseLegacyBackup(JSON.parse(text));
    const general = await getGeneral();
    if (general.baseCurrency !== "EUR") throw new Error("Das bisherige Handelsbuch rechnete in EUR – bitte Basiswährung EUR einstellen.");
    const idMap = new Map<string, string>();
    for (const a of data.instruments) {
      const i = await upsertInstrument({ symbol: a.symbol, name: a.name, assetType: a.assetType, currency: "EUR", exchange: null });
      idMap.set(a.legacyId, i.id);
      if (a.manualPriceEur != null) await prisma.quote.create({ data: { instrumentId: i.id, last: a.manualPriceEur, currency: "EUR", provider: "manuell (altes Handelsbuch)", fetchedAt: new Date(), quoteTime: null } });
    }
    const batch = await prisma.importBatch.create({ data: { kind: "LEGACY_JSON", rowsTotal: data.transactions.length, accepted: data.transactions.length, rejected: data.warnings.length } });
    for (const t of data.transactions) {
      await prisma.transaction.create({ data: { instrumentId: idMap.get(t.legacyAssetId)!, side: t.side, tradeDate: new Date(t.tradeDate + "T00:00:00Z"), quantity: t.quantity, price: t.price, priceCurrency: "EUR", fees: t.fees, feeCurrency: "EUR", fxToBase: 1, fxSource: "altes Handelsbuch (EUR)", note: t.note, importBatchId: batch.id, seq: t.seq } });
    }
    for (const p of data.plans) {
      const i = await upsertInstrument({ symbol: p.symbol, name: p.name, assetType: p.assetType, currency: "EUR", exchange: null }, { onWatchlist: true });
      if (p.entry != null) await prisma.plannedTranche.create({ data: { instrumentId: i.id, triggerPrice: p.entry, currency: "EUR", amount: p.qty != null ? p.qty * p.entry : 0, condition: "Wunschkurs aus altem Handelsbuch", note: p.note } });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `Übernommen: ${data.instruments.length} Werte, ${data.transactions.length} Buchungen, ${data.plans.length} Beobachtungen.${data.warnings.length ? " Hinweise: " + data.warnings.join("; ") : ""}` };
  } catch (e) { return fail(e); }
}

export async function addCash(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const date = parseDateFlexible(str(f, "date"));
    const amount = numOrNull(f, "amount");
    if (!date || !(amount && amount > 0)) throw new Error("Datum und positiver Betrag erforderlich");
    const type = z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]).parse(str(f, "type"));
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(str(f, "currency").toUpperCase());
    await prisma.cashMovement.create({ data: { date: new Date(date + "T00:00:00Z"), type, amount, currency, note: str(f, "note") || null } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Cashbewegung gespeichert." };
  } catch (e) { return fail(e); }
}

export async function addWatch(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const inst = InstrumentInput.parse({ symbol: str(f, "symbol").toUpperCase(), name: str(f, "name"), assetType: str(f, "assetType"), currency: str(f, "currency").toUpperCase(), exchange: str(f, "exchange") || null });
    const i = await upsertInstrument(inst, { onWatchlist: true, sector: str(f, "sector") || null, coingeckoId: str(f, "coingeckoId") || null });
    if (str(f, "breadth") === "on") await prisma.instrument.update({ where: { id: i.id }, data: { inBreadthUniverse: true } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${i.symbol} auf der Watchlist.` };
  } catch (e) { return fail(e); }
}

export async function saveMeta(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    rejectSecrets(str(f, "thesis"), str(f, "notes"));
    const instrumentId = str(f, "instrumentId");
    const marks = str(f, "rebuyMarks").split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => { const v = parseDecimal(x); if (v == null) throw new Error(`Nachkaufmarke „${x}“ ist keine Zahl`); return v; });
    const inst = await prisma.instrument.findUniqueOrThrow({ where: { id: instrumentId } });
    const data = {
      thesis: str(f, "thesis") || null, thesisStatus: str(f, "thesisStatus") || null, horizon: str(f, "horizon") || null,
      targetWeightPct: numOrNull(f, "targetWeightPct"), maxWeightPct: numOrNull(f, "maxWeightPct"), riskNotes: str(f, "riskNotes") || null, notes: str(f, "notes") || null,
      preference: str(f, "preference") || null, preferenceNote: str(f, "preferenceNote") || null,
      rebuyMarks: marks.map((p) => ({ price: p, currency: inst.currency, label: "persönliche Marke" })) as Prisma.InputJsonValue,
    };
    await prisma.positionMeta.upsert({ where: { instrumentId }, create: { instrumentId, ...data }, update: data });
    if (str(f, "businessModel")) await prisma.instrument.update({ where: { id: instrumentId }, data: { businessModel: str(f, "businessModel"), sector: str(f, "sector") || inst.sector } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Gespeichert." };
  } catch (e) { return fail(e); }
}

export async function saveValuation(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const instrumentId = str(f, "instrumentId");
    const sc = (label: "konservativ" | "basis" | "optimistisch") => ({ label, revenueGrowthPct: numOrNull(f, `${label}_g`), netMarginPct: numOrNull(f, `${label}_m`), annualDilutionPct: numOrNull(f, `${label}_d`) ?? 0, fairPe: numOrNull(f, `${label}_pe`) });
    const a = ValuationAssumptionsSchema.parse({
      baseYear: Number(str(f, "baseYear")), revenue: numOrNull(f, "revenue"), sharesOutstanding: numOrNull(f, "shares"), currency: str(f, "currency").toUpperCase(),
      discountRatePct: numOrNull(f, "discount"), epsForward: numOrNull(f, "epsForward"), epsGrowthPct: numOrNull(f, "epsGrowth"), source: str(f, "source") || "manuell",
      scenarios: [sc("konservativ"), sc("basis"), sc("optimistisch")],
    });
    const existing = await prisma.valuationModel.findFirst({ where: { instrumentId } });
    if (existing) await prisma.valuationModel.update({ where: { id: existing.id }, data: { assumptions: a as unknown as Prisma.InputJsonValue, note: str(f, "note") || null } });
    else await prisma.valuationModel.create({ data: { instrumentId, assumptions: a as unknown as Prisma.InputJsonValue, note: str(f, "note") || null } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Bewertungsannahmen gespeichert." };
  } catch (e) { return fail(e); }
}

export async function addLevel(f: FormData) {
  const price = parseDecimal(str(f, "price"));
  if (price == null || price <= 0) return;
  await prisma.manualLevel.create({ data: { instrumentId: str(f, "instrumentId"), price, kind: str(f, "kind") === "RESISTANCE" ? "RESISTANCE" : "SUPPORT", note: str(f, "note") || null } });
  revalidatePath("/", "layout");
}

export async function addThesisEvent(f: FormData) {
  const text = str(f, "text");
  if (!text || looksLikeSecretMaterial(text)) return;
  const kind = z.enum(["POSITIV", "NEGATIV", "EREIGNIS", "THESE_VERLETZT"]).parse(str(f, "kind"));
  await prisma.thesisEvent.create({ data: { instrumentId: str(f, "instrumentId"), date: new Date(todayIso() + "T00:00:00Z"), kind, text } });
  if (kind === "THESE_VERLETZT") await prisma.positionMeta.upsert({ where: { instrumentId: str(f, "instrumentId") }, create: { instrumentId: str(f, "instrumentId"), thesisStatus: "VERLETZT" }, update: { thesisStatus: "VERLETZT" } });
  revalidatePath("/", "layout");
}

export async function addAnalystAction(f: FormData) {
  const date = parseDateFlexible(str(f, "date"));
  if (!date) return;
  await prisma.analystAction.create({ data: { instrumentId: str(f, "instrumentId"), date: new Date(date + "T00:00:00Z"), firm: str(f, "firm") || null, action: z.enum(["UPGRADE", "DOWNGRADE", "INIT", "REITERATE", "TARGET_CHANGE"]).parse(str(f, "action")), priceTarget: numOrNull(f, "priceTarget"), provider: "manuell", fetchedAt: new Date() } });
  revalidatePath("/", "layout");
}

export async function addTranche(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const symbol = str(f, "symbol").toUpperCase();
    const inst = await prisma.instrument.findUnique({ where: { symbol } });
    if (!inst) throw new Error(`${symbol} unbekannt – zuerst auf die Watchlist setzen`);
    const amount = numOrNull(f, "amount");
    if (!(amount && amount > 0)) throw new Error("Betrag > 0 erforderlich");
    await prisma.plannedTranche.create({ data: { instrumentId: inst.id, triggerPrice: numOrNull(f, "triggerPrice"), currency: inst.currency, amount, condition: str(f, "condition") || null, note: str(f, "note") || null } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Tranche geplant (keine Order)." };
  } catch (e) { return fail(e); }
}

export async function setTrancheStatus(f: FormData) {
  await prisma.plannedTranche.update({ where: { id: str(f, "id") }, data: { status: z.enum(["OFFEN", "AUSGEFÜHRT_MANUELL", "VERWORFEN"]).parse(str(f, "status")) } });
  revalidatePath("/", "layout");
}

export async function addSavingsPlan(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const inst = await prisma.instrument.findUnique({ where: { symbol: str(f, "symbol").toUpperCase() } });
    if (!inst) throw new Error("Wert unbekannt – zuerst anlegen");
    const amount = numOrNull(f, "amount");
    if (!(amount && amount > 0)) throw new Error("Betrag > 0 erforderlich");
    const start = parseDateFlexible(str(f, "startDate")) ?? todayIso();
    await prisma.savingsPlan.create({ data: { instrumentId: inst.id, amount, currency: str(f, "currency").toUpperCase() || "EUR", interval: str(f, "interval") === "QUARTERLY" ? "QUARTERLY" : "MONTHLY", dayOfMonth: Math.min(28, Math.max(1, Number(str(f, "day")) || 1)), startDate: new Date(start + "T00:00:00Z") } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Sparplan gespeichert (Erinnerung/Planung, keine Ausführung)." };
  } catch (e) { return fail(e); }
}

export async function saveSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const kind = z.enum(["rules", "scoreWeights", "general"]).parse(str(f, "kind"));
    const obj: Record<string, unknown> = {};
    for (const [k, v] of f.entries()) {
      if (k === "kind" || k.startsWith("$")) continue;
      const s = String(v).trim();
      if (s === "") continue;
      const n = parseDecimal(s);
      obj[k] = n != null && !/^[A-Za-z]/.test(s) ? n : s;
    }
    await saveSetting(kind, obj);
    revalidatePath("/", "layout");
    return { ok: true, message: "Einstellungen gespeichert." };
  } catch (e) { return fail(e); }
}

export async function toggleProvider(f: FormData) {
  const id = str(f, "providerId");
  if (!PROVIDERS.some((p) => p.id === id)) return;
  const enabled = str(f, "enabled") === "1";
  await prisma.providerState.upsert({ where: { providerId: id }, create: { providerId: id, enabled }, update: { enabled } });
  revalidatePath("/einstellungen");
}

export async function runRefresh(_: ActionState): Promise<ActionState> {
  const r = await refreshAll();
  revalidatePath("/", "layout");
  const ok = r.filter((x) => x.ok).length;
  return { ok: ok > 0 || r.length === 0, message: r.length ? `${ok} erfolgreich, ${r.length - ok} fehlgeschlagen/übersprungen. Details im Abrufprotokoll.` : "Nichts zu tun (alles heute bereits geladen oder keine Provider aktiv)." };
}

export async function importFlows(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const text = str(f, "table");
    if (text.length > 2_000_000) throw new Error("Tabelle zu groß");
    const provider = z.enum(["farside", "sosovalue", "manual"]).parse(str(f, "provider"));
    const assetClass = z.string().regex(/^[A-Z0-9_]{2,12}$/).parse(str(f, "assetClass").toUpperCase());
    const r = parseWideFlowTable(text, { assetClass, provider, status: "UNBESTÄTIGT" });
    if (!r.rows.length) throw new Error("Keine Flusswerte erkannt – erwartet: Kopfzeile mit Datum und Fonds-Tickern");
    const n = await upsertFlows(r.rows, new Date());
    revalidatePath("/flows");
    return { ok: true, message: `${n} Tageswerte für ${r.tickers.length} Fonds übernommen; ${r.skipped.length} Zeilen übersprungen (Summen/ohne Datum).` };
  } catch (e) { return fail(e); }
}

export async function ptrFromText(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const filing = await prisma.politicianFiling.findUniqueOrThrow({ where: { id: str(f, "filingId") } });
    const text = str(f, "text");
    if (text.length > 200_000) throw new Error("Text zu lang");
    const rows = parsePtrText(text, { politicianName: filing.filerName, chamber: filing.chamber === "SENATE" ? "SENATE" : "HOUSE", filedDate: filing.filedDate?.toISOString().slice(0, 10) ?? null, state: filing.stateDistrict });
    if (!rows.length) throw new Error("Keine Transaktionszeilen erkannt – bitte manuell erfassen.");
    const c = await ingestPoliticianTx(rows, new Date(), todayIso(), filing.id);
    await prisma.politicianFiling.update({ where: { id: filing.id }, data: { rawText: text, status: "AUTOMATISCH_EXTRAHIERT" } });
    revalidatePath("/politiker");
    return { ok: true, message: `${rows.length} Zeilen extrahiert (neu: ${c.INSERT}, Prüfung: ${c.REVIEW}). Alle Einträge benötigen eine manuelle Prüfung gegen das Original.` };
  } catch (e) { return fail(e); }
}

export async function markReviewed(f: FormData) {
  await prisma.politicianTransaction.update({ where: { id: str(f, "id") }, data: { needsReview: false, reviewedAt: new Date(), reviewNote: str(f, "note") || null, status: "MANUELL_GEPRUEFT" } });
  revalidatePath("/politiker");
}

export async function saveManualFx(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const pair = z.string().regex(/^[A-Z]{6}$/).parse(str(f, "pair").toUpperCase());
    const rate = numOrNull(f, "rate");
    const date = parseDateFlexible(str(f, "date"));
    if (!(rate && rate > 0) || !date) throw new Error("Kurs > 0 und Datum erforderlich");
    const cur = await prisma.setting.findUnique({ where: { key: "manualFx" } });
    const list = ((cur?.value as { pair: string }[]) ?? []).filter((x) => x.pair !== pair);
    list.push({ pair, rate, date, source: "manuell" } as never);
    await prisma.setting.upsert({ where: { key: "manualFx" }, create: { key: "manualFx", value: list as Prisma.InputJsonValue }, update: { value: list as Prisma.InputJsonValue } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Manueller Kurs ${pair} gespeichert (nur genutzt, wenn keine Quelle liefert).` };
  } catch (e) { return fail(e); }
}
