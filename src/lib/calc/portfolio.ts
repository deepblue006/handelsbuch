/**
 * Portfolio-Berechnung (FIFO) – übernimmt die Logik des früheren Handelsbuchs (ehemals index.html, entfernt):
 * Verkäufe werden nach FIFO gegen die ältesten Käufe gebucht; für Krypto wird je Kauf-Lot
 * die einjährige Haltefrist ausgewiesen (Hinweis, keine Steuerberatung).
 *
 * Erweiterungen: Handelswährung vs. Basiswährung, historische Wechselkurse, Gebühren und
 * Dividenden getrennt, Kurs- und Währungseffekt, Gewichte, Konzentration, Modified-Dietz-Rendite.
 *
 * Fehlende Kurse oder Wechselkurse führen zu `null` und einer Warnung – nie zu stillen Annahmen.
 */
import { FxTable, decomposeReturn } from "./fx";

export type Side = "BUY" | "SELL" | "DIVIDEND";
export type PAssetType = "STOCK" | "ETF" | "CRYPTO" | "INDEX_PROXY" | "OTHER";

export interface PInstrument {
  id: string;
  symbol: string;
  name: string;
  assetType: PAssetType;
  currency: string;
  sector?: string | null;
  maxWeightPct?: number | null;
  targetWeightPct?: number | null;
}

export interface PTx {
  id: string;
  instrumentId: string;
  side: Side;
  tradeDate: string; // yyyy-mm-dd
  quantity: number;
  price: number; // je Stück; bei DIVIDEND Gesamtbetrag
  priceCurrency: string;
  fees: number;
  feeCurrency?: string | null;
  fxToBase?: number | null; // Basis je 1 Einheit priceCurrency am Handelstag
  seq?: number;
}

export interface PPrice {
  instrumentId: string;
  price: number;
  currency: string;
  asOf: string; // Datenstand des Kurses
  source: string;
  isDemo?: boolean;
}

export interface Lot {
  txId: string;
  date: string;
  qty: number;
  left: number;
  unitCostCcy: number; // inkl. anteiliger Kaufgebühren, in Handelswährung
  unitCostBase: number | null; // inkl. Gebühren, zum historischen Kurs
  holdingFreeFrom: string; // Datum, ab dem > 1 Jahr gehalten
}

export interface RealizedEntry {
  txId: string;
  instrumentId: string;
  date: string;
  qty: number;
  proceedsBase: number | null;
  costBase: number | null;
  plBase: number | null;
  unmatchedQty: number;
  // Krypto: Anteil aus Lots mit > 1 Jahr Haltedauer
  plOverOneYearBase: number | null;
  plUnderOneYearBase: number | null;
}

export interface PositionResult {
  instrument: PInstrument;
  qty: number;
  lots: Lot[];
  costCcy: number;
  avgCostCcy: number;
  costBase: number | null;
  price: PPrice | null;
  fxNow: { rate: number; path: string; date: string | null; source: string | null } | null;
  valueCcy: number | null;
  valueBase: number | null;
  unrealizedBase: number | null;
  priceEffectBase: number | null;
  fxEffectBase: number | null;
  unrealizedPct: number | null;
  vsCostPct: number | null; // Kurs vs. durchschnittlicher Einstand (Handelswährung)
  realizedBase: number;
  dividendsBase: number;
  feesBase: number;
  weightPct: number | null;
  warnings: string[];
}

export interface PortfolioResult {
  baseCurrency: string;
  positions: PositionResult[];
  closedRealized: RealizedEntry[];
  investedValueBase: number;
  cashBase: number | null;
  totalBase: number;
  cashQuotaPct: number | null;
  costBaseTotal: number;
  unrealizedBase: number;
  realizedBase: number;
  dividendsBase: number;
  feesBase: number;
  missingValue: string[]; // Symbole ohne Bewertung
  byAssetType: Record<string, number>;
  bySector: Record<string, number>;
  concentration: { top1Pct: number | null; top3Pct: number | null; hhi: number | null; largest: string | null };
  warnings: string[];
}

const EPS = 1e-10;

export function addYears(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const m = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== m) d.setUTCDate(0); // 29.02. → 28.02.
  return d.toISOString().slice(0, 10);
}

/** Wie im bisherigen Handelsbuch: steuerfrei-Hinweis ab Jahrestag des Kaufs (§ 23 EStG, keine Steuerberatung). */
export function isOverOneYear(buyISO: string, refISO: string): boolean {
  return refISO >= addYears(buyISO, 1);
}

function sortTx(txs: PTx[]): PTx[] {
  return [...txs].sort((a, b) => (a.tradeDate === b.tradeDate ? (a.seq ?? 0) - (b.seq ?? 0) : a.tradeDate < b.tradeDate ? -1 : 1));
}

function txFxToBase(t: PTx, base: string): number | null {
  if (t.priceCurrency.toUpperCase() === base.toUpperCase()) return 1;
  return t.fxToBase != null && t.fxToBase > 0 ? t.fxToBase : null;
}

function feeInBase(t: PTx, base: string): number | null {
  if (!t.fees) return 0;
  const fc = (t.feeCurrency ?? t.priceCurrency).toUpperCase();
  if (fc === base.toUpperCase()) return t.fees;
  if (fc === t.priceCurrency.toUpperCase()) {
    const fx = txFxToBase(t, base);
    return fx == null ? null : t.fees * fx;
  }
  return null;
}

function feeInTradeCcy(t: PTx, base: string): number | null {
  if (!t.fees) return 0;
  const fc = (t.feeCurrency ?? t.priceCurrency).toUpperCase();
  if (fc === t.priceCurrency.toUpperCase()) return t.fees;
  if (fc === base.toUpperCase()) {
    const fx = txFxToBase(t, base);
    return fx == null ? null : t.fees / fx;
  }
  return null;
}

export interface ComputeOptions {
  baseCurrency: string;
  today: string;
  cashBase?: number | null;
}

export function computePortfolio(
  instruments: PInstrument[],
  txs: PTx[],
  prices: PPrice[],
  fx: FxTable,
  opts: ComputeOptions,
): PortfolioResult {
  const base = opts.baseCurrency.toUpperCase();
  const instById = new Map(instruments.map((i) => [i.id, i]));
  const priceById = new Map(prices.map((p) => [p.instrumentId, p]));
  const state = new Map<string, { lots: Lot[]; realized: number; dividends: number; fees: number; warnings: string[] }>();
  const realized: RealizedEntry[] = [];
  const globalWarnings: string[] = [];

  for (const i of instruments) state.set(i.id, { lots: [], realized: 0, dividends: 0, fees: 0, warnings: [] });

  for (const t of sortTx(txs)) {
    const inst = instById.get(t.instrumentId);
    const st = state.get(t.instrumentId);
    if (!inst || !st) { globalWarnings.push(`Buchung ${t.id} verweist auf unbekannten Wert`); continue; }
    const fxB = txFxToBase(t, base);
    const feeB = feeInBase(t, base);
    const feeC = feeInTradeCcy(t, base);
    if (feeB != null) st.fees += feeB;
    else if (t.fees) st.warnings.push(`Gebühr vom ${t.tradeDate} nicht in ${base} umrechenbar (Wechselkurs fehlt)`);
    if (t.priceCurrency.toUpperCase() !== inst.currency.toUpperCase() && t.side !== "DIVIDEND") {
      st.warnings.push(`Buchung vom ${t.tradeDate} in ${t.priceCurrency}, Handelswährung ist ${inst.currency} – bitte prüfen`);
    }
    if (fxB == null) st.warnings.push(`Historischer Wechselkurs ${t.priceCurrency}/${base} für ${t.tradeDate} fehlt`);

    if (t.side === "DIVIDEND") {
      if (fxB != null) st.dividends += t.price * t.quantity * fxB - (feeB ?? 0);
      continue;
    }
    if (t.side === "BUY") {
      const gross = t.quantity * t.price + (feeC ?? 0);
      const unitCcy = t.quantity > 0 ? gross / t.quantity : 0;
      st.lots.push({
        txId: t.id,
        date: t.tradeDate,
        qty: t.quantity,
        left: t.quantity,
        unitCostCcy: unitCcy,
        unitCostBase: fxB == null || feeB == null ? null : (t.quantity * t.price * fxB + feeB) / t.quantity,
        holdingFreeFrom: addYears(t.tradeDate, 1),
      });
      continue;
    }
    // SELL – FIFO
    let rest = t.quantity;
    let costBase: number | null = 0;
    let costOver: number | null = 0, costUnder: number | null = 0;
    let qtyOver = 0, qtyUnder = 0;
    while (rest > EPS && st.lots.length) {
      const lot = st.lots[0]!;
      const take = Math.min(lot.left, rest);
      const c = lot.unitCostBase == null ? null : take * lot.unitCostBase;
      costBase = costBase == null || c == null ? null : costBase + c;
      if (isOverOneYear(lot.date, t.tradeDate)) { qtyOver += take; costOver = costOver == null || c == null ? null : costOver + c; }
      else { qtyUnder += take; costUnder = costUnder == null || c == null ? null : costUnder + c; }
      lot.left -= take;
      rest -= take;
      if (lot.left <= EPS) st.lots.shift();
    }
    const unmatched = rest > 1e-9 ? rest : 0;
    if (unmatched) st.warnings.push(`Verkauf vom ${t.tradeDate}: ${unmatched} Stück ohne passenden Kauf`);
    const matchedQty = t.quantity - unmatched;
    const proceedsBase = fxB == null || feeB == null ? null : matchedQty * t.price * fxB - feeB * (t.quantity ? matchedQty / t.quantity : 0);
    const pl = proceedsBase == null || costBase == null ? null : proceedsBase - costBase;
    let plOver: number | null = null, plUnder: number | null = null;
    if (inst.assetType === "CRYPTO" && proceedsBase != null && costOver != null && costUnder != null && matchedQty > 0) {
      plOver = proceedsBase * (qtyOver / matchedQty) - costOver;
      plUnder = proceedsBase * (qtyUnder / matchedQty) - costUnder;
    }
    if (pl != null) st.realized += pl;
    realized.push({
      txId: t.id, instrumentId: t.instrumentId, date: t.tradeDate, qty: t.quantity,
      proceedsBase, costBase, plBase: pl, unmatchedQty: unmatched,
      plOverOneYearBase: plOver, plUnderOneYearBase: plUnder,
    });
  }

  const positions: PositionResult[] = [];
  for (const inst of instruments) {
    const st = state.get(inst.id)!;
    const qty = st.lots.reduce((s, l) => s + l.left, 0);
    const hadActivity = txs.some((t) => t.instrumentId === inst.id);
    if (!hadActivity) continue;
    const costCcy = st.lots.reduce((s, l) => s + l.left * l.unitCostCcy, 0);
    const costBase = st.lots.some((l) => l.unitCostBase == null) ? null : st.lots.reduce((s, l) => s + l.left * l.unitCostBase!, 0);
    const avgCostCcy = qty > EPS ? costCcy / qty : 0;
    const price = priceById.get(inst.id) ?? null;
    const warnings = [...st.warnings];
    let fxNow: PositionResult["fxNow"] = null;
    let valueCcy: number | null = null, valueBase: number | null = null;
    let unrealizedBase: number | null = null, priceEffectBase: number | null = null, fxEffectBase: number | null = null;
    if (qty > EPS) {
      if (!price) warnings.push("Kein Kurs vorhanden – Marktwert unbekannt");
      else {
        if (price.currency.toUpperCase() !== inst.currency.toUpperCase()) warnings.push(`Kurs in ${price.currency}, Handelswährung ${inst.currency}`);
        valueCcy = qty * price.price;
        const r = fx.rate(price.currency, base);
        if (!r) warnings.push(`Aktueller Wechselkurs ${price.currency}/${base} fehlt`);
        else {
          fxNow = r;
          valueBase = valueCcy * r.rate;
          if (costBase != null) {
            const d = decomposeReturn(qty, avgCostCcy, costBase, price.price, r.rate);
            unrealizedBase = d.total;
            priceEffectBase = d.priceEffect;
            fxEffectBase = d.fxEffect;
          }
        }
      }
    }
    positions.push({
      instrument: inst, qty, lots: st.lots.map((l) => ({ ...l })), costCcy, avgCostCcy, costBase,
      price, fxNow, valueCcy, valueBase, unrealizedBase, priceEffectBase, fxEffectBase,
      unrealizedPct: unrealizedBase != null && costBase ? (unrealizedBase / costBase) * 100 : null,
      vsCostPct: price && avgCostCcy > 0 && price.currency.toUpperCase() === inst.currency.toUpperCase() ? ((price.price - avgCostCcy) / avgCostCcy) * 100 : null,
      realizedBase: st.realized, dividendsBase: st.dividends, feesBase: st.fees,
      weightPct: null, warnings,
    });
  }

  const open = positions.filter((p) => p.qty > EPS);
  const investedValueBase = open.reduce((s, p) => s + (p.valueBase ?? 0), 0);
  const cashBase = opts.cashBase ?? null;
  const totalBase = investedValueBase + (cashBase ?? 0);
  for (const p of open) p.weightPct = p.valueBase != null && totalBase > 0 ? (p.valueBase / totalBase) * 100 : null;

  const byAssetType: Record<string, number> = {};
  const bySector: Record<string, number> = {};
  for (const p of open) {
    if (p.valueBase == null) continue;
    byAssetType[p.instrument.assetType] = (byAssetType[p.instrument.assetType] ?? 0) + p.valueBase;
    const sec = p.instrument.assetType === "CRYPTO" ? "Krypto" : p.instrument.sector ?? "Unbekannt";
    bySector[sec] = (bySector[sec] ?? 0) + p.valueBase;
  }
  if (cashBase) byAssetType["CASH"] = cashBase;

  const weights = open.map((p) => ({ s: p.instrument.symbol, w: p.weightPct })).filter((x): x is { s: string; w: number } => x.w != null).sort((a, b) => b.w - a.w);
  const concentration = weights.length
    ? {
        top1Pct: weights[0]!.w,
        top3Pct: weights.slice(0, 3).reduce((s, x) => s + x.w, 0),
        hhi: weights.reduce((s, x) => s + (x.w / 100) ** 2, 0),
        largest: weights[0]!.s,
      }
    : { top1Pct: null, top3Pct: null, hhi: null, largest: null };

  const warnings = [...globalWarnings];
  for (const p of open) {
    const max = p.instrument.maxWeightPct;
    if (max != null && p.weightPct != null && p.weightPct > max) warnings.push(`${p.instrument.symbol}: Gewicht ${p.weightPct.toFixed(1)} % über persönlicher Obergrenze ${max} %`);
  }
  const missingValue = open.filter((p) => p.valueBase == null).map((p) => p.instrument.symbol);
  if (missingValue.length) warnings.push(`Ohne Bewertung (nicht in Summen enthalten): ${missingValue.join(", ")}`);

  return {
    baseCurrency: base,
    positions,
    closedRealized: realized,
    investedValueBase,
    cashBase,
    totalBase,
    cashQuotaPct: cashBase != null && totalBase > 0 ? (cashBase / totalBase) * 100 : null,
    costBaseTotal: open.reduce((s, p) => s + (p.costBase ?? 0), 0),
    unrealizedBase: open.reduce((s, p) => s + (p.unrealizedBase ?? 0), 0),
    realizedBase: positions.reduce((s, p) => s + p.realizedBase, 0),
    dividendsBase: positions.reduce((s, p) => s + p.dividendsBase, 0),
    feesBase: positions.reduce((s, p) => s + p.feesBase, 0),
    missingValue,
    byAssetType,
    bySector,
    concentration,
    warnings,
  };
}

/** Bestand je Instrument zu einem Stichtag (inklusive Buchungen dieses Tages). */
export function holdingsAt(txs: PTx[], date: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of sortTx(txs)) {
    if (t.tradeDate > date || t.side === "DIVIDEND") continue;
    m.set(t.instrumentId, (m.get(t.instrumentId) ?? 0) + (t.side === "BUY" ? t.quantity : -t.quantity));
  }
  return m;
}

export interface DietzResult {
  returnPct: number;
  startValue: number;
  endValue: number;
  netFlows: number;
  method: string;
}

/**
 * Modified-Dietz-Rendite des investierten Teils für [start, end].
 * R = (V_end − V_start − CF) / (V_start + Σ w_i·CF_i), w_i = Anteil der Restlaufzeit nach dem Fluss.
 * Käufe sind positive, Verkäufe negative Flüsse (in Basiswährung, zum Buchungskurs).
 * valueAt muss den Depotwert in Basiswährung zum Stichtag liefern oder null, wenn Kurse fehlen.
 */
export function modifiedDietz(
  txs: PTx[],
  base: string,
  start: string,
  end: string,
  valueAt: (date: string) => number | null,
): DietzResult | null {
  const v0 = valueAt(start);
  const v1 = valueAt(end);
  if (v0 == null || v1 == null) return null;
  const t0 = Date.parse(start + "T00:00:00Z");
  const t1 = Date.parse(end + "T00:00:00Z");
  const span = (t1 - t0) / 86400000;
  if (span <= 0) return null;
  let cf = 0, weighted = 0;
  for (const t of txs) {
    if (t.tradeDate <= start || t.tradeDate > end || t.side === "DIVIDEND") continue;
    const fxB = txFxToBase(t, base);
    if (fxB == null) return null;
    const amt = t.quantity * t.price * fxB * (t.side === "BUY" ? 1 : -1);
    const w = (t1 - Date.parse(t.tradeDate + "T00:00:00Z")) / 86400000 / span;
    cf += amt;
    weighted += w * amt;
  }
  const denom = v0 + weighted;
  if (denom <= 0) return null;
  return {
    returnPct: ((v1 - v0 - cf) / denom) * 100,
    startValue: v0,
    endValue: v1,
    netFlows: cf,
    method: "Modified Dietz (geldgewichtete Näherung), Flüsse = Käufe/Verkäufe zum Buchungskurs",
  };
}
