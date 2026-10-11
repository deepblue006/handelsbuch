import { prisma } from "../db";
import { computePortfolio, type PInstrument, type PTx, type PortfolioResult } from "../calc/portfolio";
import { fxTable, latestPrice, type PriceInfo } from "./data";
import { getGeneral, todayIso } from "../settings";

export interface PortfolioView {
  result: PortfolioResult;
  prices: Map<string, PriceInfo>;
  hasDemo: boolean;
  cash: { base: number | null; movements: number; missingFx: string[] };
  fxRates: Awaited<ReturnType<typeof fxTable>>["rates"];
  today: string;
  base: string;
}

export async function loadPortfolio(): Promise<PortfolioView> {
  const general = await getGeneral();
  const base = general.baseCurrency;
  const today = todayIso(general.timezone);
  const [instruments, txs, metas, cashRows] = await Promise.all([
    prisma.instrument.findMany({ where: { transactions: { some: {} } } }),
    prisma.transaction.findMany({ orderBy: [{ tradeDate: "asc" }, { seq: "asc" }] }),
    prisma.positionMeta.findMany(),
    prisma.cashMovement.findMany(),
  ]);
  const metaBy = new Map(metas.map((m) => [m.instrumentId, m]));
  const { table, rates } = await fxTable();
  const prices = new Map<string, PriceInfo>();
  for (const i of instruments) {
    const p = await latestPrice(i);
    if (p) prices.set(i.id, p);
  }
  // Cash in Basiswährung; Fremdwährungsbewegungen nur mit verfügbarem Kurs
  let cashBase: number | null = cashRows.length ? 0 : null;
  const missingFx: string[] = [];
  for (const c of cashRows) {
    const conv = table.convert(c.amount, c.currency, base);
    if (!conv) { missingFx.push(c.currency); continue; }
    cashBase = (cashBase ?? 0) + (c.type === "WITHDRAWAL" ? -conv.value : conv.value);
  }
  const pInst: PInstrument[] = instruments.map((i) => ({
    id: i.id, symbol: i.symbol, name: i.name, assetType: i.assetType, currency: i.currency, sector: i.sector,
    maxWeightPct: metaBy.get(i.id)?.maxWeightPct ?? general.maxPositionWeightPct, targetWeightPct: metaBy.get(i.id)?.targetWeightPct ?? null,
  }));
  const pTx: PTx[] = txs.map((t) => ({ id: t.id, instrumentId: t.instrumentId, side: t.side, tradeDate: t.tradeDate.toISOString().slice(0, 10), quantity: t.quantity, price: t.price, priceCurrency: t.priceCurrency, fees: t.fees, feeCurrency: t.feeCurrency, fxToBase: t.fxToBase, seq: t.seq }));
  const result = computePortfolio(pInst, pTx, [...prices.values()], table, { baseCurrency: base, today, cashBase });
  const hasDemo = txs.some((t) => t.isDemo) || cashRows.some((c) => c.isDemo) || instruments.some((i) => i.isDemo);
  return { result, prices, hasDemo, cash: { base: cashBase, movements: cashRows.length, missingFx: [...new Set(missingFx)] }, fxRates: rates, today, base };
}
