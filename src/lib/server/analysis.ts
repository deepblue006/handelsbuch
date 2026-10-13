/**
 * Vollständige, nachvollziehbare Analyse eines Assets: Charttechnik, Fundamentaldaten,
 * Bewertungsszenarien, Termine, Regelwerk und Kaufsignalscore.
 */
import { prisma } from "../db";
import {
  sma, ema, rsi, findCrosses, fibonacci, confluence, weinsteinStage, pivots, zonesFromPivots, roundLevels, adr, upDownVolume,
  detectPossibleSplits, toWeekly, annualizedVolatility, distancePct, pctChange, type Bar,
} from "../calc/indicators";
import { scenarioFairValue, peg, fcfYieldPct, metricSuitability, type ScenarioAssumptions, type BusinessModel } from "../calc/valuation";
import { evaluateRules } from "../rules/engine";
import { buildComponents } from "../score/components";
import { aggregateScore } from "../score/score";
import { getBars, splitEvents, splitSafe, type SeriesResult } from "./data";
import { loadPortfolio } from "./portfolio";
import { indexViews, breadthView, effectiveBreadth } from "./market";
import { getRuleConfig, getScoreWeights, getGeneral, todayIso } from "../settings";
import { assessFreshness } from "../data/quality";
import { z } from "zod";
import { eventBacktest, below } from "../calc/backtest";
import { forwardEstimates, type EpsEstimate, type parseInstitutionalHoldings } from "../providers/alphavantage";

export const ValuationAssumptionsSchema = z.object({
  baseYear: z.number().int(),
  revenue: z.number().positive(),
  sharesOutstanding: z.number().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  discountRatePct: z.number().min(0).max(50).nullable().optional(),
  epsForward: z.number().nullable().optional(), // Konsens-/eigene EPS-Schätzung (FY1) für PEG/Forward-KGV
  epsGrowthPct: z.number().nullable().optional(),
  source: z.string().max(300).default("manuell"),
  scenarios: z.array(z.object({
    label: z.enum(["konservativ", "basis", "optimistisch"]),
    revenueGrowthPct: z.number().min(-50).max(200),
    netMarginPct: z.number().min(-100).max(100),
    annualDilutionPct: z.number().min(-20).max(50),
    fairPe: z.number().positive().max(500),
  })).length(3),
});
export type ValuationAssumptions = z.infer<typeof ValuationAssumptionsSchema>;

function seriesMeta(s: SeriesResult, today: string, frequency: "daily" | "weekly") {
  const last = s.bars.at(-1)?.date ?? null;
  return { provider: s.provider, fetchedAt: s.fetchedAt, adjusted: s.adjusted, count: s.bars.length, lastDate: last, freshness: assessFreshness({ dataDate: last, fetchedAt: s.fetchedAt, frequency, today, isDemo: s.isDemo, isSnapshot: s.isSnapshot }) };
}

export async function analyzeAsset(symbol: string) {
  const inst = await prisma.instrument.findUnique({ where: { symbol }, include: { meta: true, levels: true, thesisEvents: { orderBy: { date: "desc" } }, valuations: { orderBy: { updatedAt: "desc" }, take: 1 }, tranches: true } });
  if (!inst) return null;
  const general = await getGeneral();
  const today = todayIso(general.timezone);
  const [cfg, weights, daily, weeklyDb, portfolio] = await Promise.all([getRuleConfig(), getScoreWeights(), getBars(inst.id, "DAY"), getBars(inst.id, "WEEK"), loadPortfolio()]);

  // Wochenkurse: aus DB, sonst aus Tageskursen aggregiert (nur abgeschlossene Wochen)
  const weeklyBars: Bar[] = weeklyDb.bars.length ? weeklyDb.bars : toWeekly(daily.bars, today).filter((w) => w.complete);
  const weeklySource = weeklyDb.bars.length ? "Wochenkurse des Providers" : daily.bars.length ? "aus Tageskursen aggregiert" : "keine";

  const dc = daily.bars.map((b) => b.close);
  const wc = weeklyBars.map((b) => b.close);
  const dDates = daily.bars.map((b) => b.date);
  const ind = {
    sma50: sma(dc, 50), sma100: sma(dc, 100), sma200: sma(dc, 200), ema10: ema(dc, 10), ema20: ema(dc, 20), rsi14: rsi(dc, 14), rsi5: rsi(dc, 5),
    sma30w: sma(wc, 30), sma200w: sma(wc, 200), rsi14w: rsi(wc, 14),
  };
  const lastDaily = daily.bars.at(-1) ?? null;
  const lastWeekly = weeklyBars.at(-1) ?? null;
  const pos = portfolio.result.positions.find((p) => p.instrument.id === inst.id && p.qty > 1e-10) ?? null;
  const priceInfo = portfolio.prices.get(inst.id) ?? null;
  const price = lastDaily && (!lastWeekly || lastDaily.date >= lastWeekly.date) ? lastDaily.close : lastWeekly?.close ?? priceInfo?.price ?? null;
  const priceDate = lastDaily && (!lastWeekly || lastDaily.date >= lastWeekly.date) ? lastDaily.date : lastWeekly?.date ?? priceInfo?.asOf ?? null;

  const stage = wc.length ? weinsteinStage(wc) : null;
  const fibBase = daily.bars.length >= 30 ? daily.bars : weeklyBars;
  const fib = fibBase.length >= 2 ? fibonacci(fibBase, daily.bars.length >= 30 ? 126 : 52, fibBase.length - 1, daily.bars.length >= 30 ? "Handelstage" : "Wochen") : null;
  const sma200Last = ind.sma200.at(-1) ?? null;
  const pv = pivots(fibBase.slice(-260), daily.bars.length >= 30 ? 5 : 3);
  const zones = price != null ? zonesFromPivots(pv, price) : [];
  const crosses = findCrosses(dDates, ind.sma50, ind.sma200);
  // Heuristische Split-Warnung nur, solange die Reihe nicht nachweislich split-sicher ist
  const dailySafe = daily.bars.length === 0 || splitSafe(daily); // leere Reihe: nichts zu warnen
  const weeklySafe = weeklyDb.bars.length ? splitSafe(weeklyDb) : dailySafe;
  const splitsDaily = dailySafe ? [] : detectPossibleSplits(daily.bars);
  const splitsWeekly = weeklySafe ? [] : detectPossibleSplits(weeklyBars.slice(-200));
  const splitEv = await splitEvents(inst.id);
  const splitInfo = {
    applied: [...new Map([...daily.split.applied, ...weeklyDb.split.applied].map((x) => [x.date, x])).values()],
    verified: dailySafe && weeklySafe && (daily.bars.length > 0 || weeklyDb.bars.length > 0),
    checkedAt: inst.splitsCheckedAt, checkedSource: inst.splitsCheckedSource,
    approximateBars: weeklyDb.split.approximateBars,
    realJumps: dailySafe || weeklySafe ? [...(dailySafe ? daily.split.residualJumps : []), ...(weeklySafe && weeklyDb.bars.length ? weeklyDb.split.residualJumps : [])] : [],
    problems: [...new Set([...daily.split.problems, ...weeklyDb.split.problems, ...splitEv.conflicts.map((c) => `Widersprüchliche Split-Angaben ${c}`)])],
    events: splitEv.rows.map((r) => ({ id: r.id, date: r.effectiveDate.toISOString().slice(0, 10), factor: r.factor, provider: r.provider, source: r.source })),
  };
  const inGoldenPocket = fib && price != null ? price >= fib.goldenPocket.from && price <= fib.goldenPocket.to : null;

  // Fundamentaldaten (SEC, Jahreswerte, Point-in-Time)
  const fund = await prisma.fundamental.findMany({ where: { instrumentId: inst.id }, orderBy: { periodEnd: "desc" } });
  const fy = (metric: string) => fund.filter((f) => f.metric === metric && f.periodType === "FY").sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
  const rev = fy("REVENUE"), ni = fy("NET_INCOME"), ocf = fy("OPERATING_CASH_FLOW"), capex = fy("CAPEX"), sbc = fy("SBC"), sh = fy("SHARES_DILUTED"), buy = fy("BUYBACKS");
  const growth = (a?: { value: number }, b?: { value: number }) => (a && b && b.value > 0 ? ((a.value - b.value) / b.value) * 100 : null);
  const revGrowth = growth(rev[0], rev[1]);
  const prevRevGrowth = growth(rev[1], rev[2]);
  const fcf = ocf[0] && capex[0] && ocf[0].periodEnd.getTime() === capex[0].periodEnd.getTime() ? ocf[0].value - capex[0].value : null;
  const marketCap = price != null && sh[0] && inst.currency === "USD" ? price * sh[0].value : null;
  const dilution = growth(sh[0], sh[1]);

  // Bewertungsmodell
  const vm = inst.valuations[0];
  const vParsed = vm ? ValuationAssumptionsSchema.safeParse(vm.assumptions) : null;
  const assumptions = vParsed?.success ? vParsed.data : null;
  const thisYear = Number(today.slice(0, 4));
  let scenarios: { horizon: string; year: number; results: ReturnType<typeof scenarioFairValue>[] }[] = [];
  let fairValueBase: number | null = null;
  if (assumptions) {
    const inp = { baseYear: assumptions.baseYear, revenue: assumptions.revenue, sharesOutstanding: assumptions.sharesOutstanding, currency: assumptions.currency, discountRatePct: assumptions.discountRatePct ?? undefined };
    const years = [{ horizon: "1–2 Jahre", year: Math.max(assumptions.baseYear, thisYear + 1) }, { horizon: "2030", year: Math.max(assumptions.baseYear, 2030) }];
    scenarios = years.map((y) => ({ ...y, results: assumptions.scenarios.map((s) => scenarioFairValue(inp, s as ScenarioAssumptions, y.year)) }));
    fairValueBase = scenarios[0]!.results.find((r) => r.label === "basis")?.fairValue ?? null;
    if (assumptions.currency !== inst.currency) fairValueBase = null; // keine stille Umrechnung
  }
  // Forward-Schätzungen: Provider-Konsens; manuelle Eingabe im Modell hat Vorrang (gekennzeichnet)
  const estRows = fund.filter((f) => f.isEstimate && (f.periodType === "FY_EST" || f.periodType === "Q_EST"));
  const estByPeriod = new Map<string, EpsEstimate>();
  for (const r of estRows) {
    const k = `${r.periodType}|${r.periodEnd.toISOString().slice(0, 10)}`;
    const e = estByPeriod.get(k) ?? { periodEnd: r.periodEnd.toISOString().slice(0, 10), horizon: r.periodType === "FY_EST" ? "FY" : "Q", eps: null, epsHigh: null, epsLow: null, analysts: null, eps30dAgo: null, eps90dAgo: null, revisionsUp30d: null, revisionsDown30d: null, revenue: null } as EpsEstimate;
    const map: Record<string, keyof EpsEstimate> = { EPS_EST: "eps", EPS_EST_HIGH: "epsHigh", EPS_EST_LOW: "epsLow", EPS_EST_ANALYSTS: "analysts", EPS_EST_30D_AGO: "eps30dAgo", EPS_EST_90D_AGO: "eps90dAgo", EPS_REV_UP_30D: "revisionsUp30d", EPS_REV_DOWN_30D: "revisionsDown30d", REVENUE_EST: "revenue" };
    const key = map[r.metric];
    if (key) (e as unknown as Record<string, unknown>)[key] = r.value;
    estByPeriod.set(k, e);
  }
  const fwd = forwardEstimates([...estByPeriod.values()], today);
  const estMeta = estRows[0] ? { provider: estRows[0].provider, fetchedAt: estRows.reduce((m, r) => (r.fetchedAt > m ? r.fetchedAt : m), estRows[0].fetchedAt) } : null;
  const manualEps = assumptions?.epsForward && assumptions.epsForward > 0 ? assumptions.epsForward : null;
  const fwdEps = manualEps ?? (inst.currency === "USD" ? fwd.fy1?.eps ?? null : null);
  const forwardPeSource = manualEps ? "manuell (Bewertungsmodell)" : fwd.fy1 ? `Konsens ${estMeta?.provider ?? ""}, GJ bis ${fwd.fy1.periodEnd}, ${fwd.fy1.analysts ?? "?"} Analysten` : null;
  const forwardPe = fwdEps && price != null ? price / fwdEps : null;
  const growthForPeg = assumptions?.epsGrowthPct ?? fwd.growthPct;
  const pegR = peg(forwardPe, growthForPeg);
  const instSummary = (await prisma.setting.findUnique({ where: { key: `inst:${inst.symbol}` } }))?.value as (ReturnType<typeof parseInstitutionalHoldings> & { provider: string; fetchedAt: string }) | undefined;

  // Termine & Analysten
  const earnings = await prisma.earningsEvent.findMany({ where: { instrumentId: inst.id, reportDate: { gte: new Date(today + "T00:00:00Z") } }, orderBy: { reportDate: "asc" }, take: 3 });
  const earningsAny = (await prisma.fetchLog.count({ where: { dataset: `earnings:${inst.symbol}`, status: "SUCCESS" } })) > 0 || earnings.length > 0;
  const lookback = new Date(today + "T00:00:00Z");
  lookback.setUTCDate(lookback.getUTCDate() - cfg.downgradeLookbackDays);
  const actions = await prisma.analystAction.findMany({ where: { instrumentId: inst.id }, orderBy: { date: "desc" }, take: 20 });
  const recentActs = actions.filter((a) => a.date >= lookback);
  const insider = await prisma.insiderTransaction.findMany({ where: { instrumentId: inst.id }, orderBy: { transactionDate: "desc" }, take: 25 });
  const insider90 = insider.filter((t) => t.transactionDate && t.transactionDate.getTime() >= Date.parse(today) - 90 * 86400000);
  const insiderSummary = { openMarketBuys: insider90.filter((t) => t.type.startsWith("KAUF")).length, openMarketSells: insider90.filter((t) => t.type.startsWith("VERKAUF")).length, other: insider90.filter((t) => !t.type.startsWith("KAUF") && !t.type.startsWith("VERKAUF")).length };
  const politicians = await prisma.politicianTransaction.findMany({ where: { ticker: inst.symbol, isCurrent: true }, orderBy: { transactionDate: "desc" }, take: 10 });

  // Marktumfeld
  const [indices, breadth, effBreadth] = await Promise.all([indexViews(), breadthView(today), effectiveBreadth(today)]);
  const spy = indices.find((i) => i.symbol === "SPY");
  const spyWeekly = spy?.weekly ?? [];
  let rel26: number | null = null;
  if (weeklyBars.length > 26 && spyWeekly.length > 26) {
    const own = pctChange(weeklyBars.at(-27)!.close, weeklyBars.at(-1)!.close);
    const idx = pctChange(spyWeekly.at(-27)!.close, spyWeekly.at(-1)!.close);
    rel26 = own != null && idx != null ? own - idx : null;
  }
  const sectorWeight = inst.sector && portfolio.result.totalBase > 0 ? ((portfolio.result.bySector[inst.sector] ?? 0) / portfolio.result.totalBase) * 100 : null;
  const flows20 = inst.assetType === "CRYPTO" ? await prisma.fundFlow.aggregate({ where: { assetClass: inst.symbol, date: { gte: new Date(Date.parse(today) - 28 * 86400000) } }, _sum: { netFlow: true }, _count: true }) : null;

  const ts = inst.meta?.thesisStatus;
  const thesisIntact = ts === "VERLETZT" ? false : ts === "INTAKT" ? true : null;

  const rules = evaluateRules({
    symbol: inst.symbol, assetType: inst.assetType, today, isHeld: !!pos, price, priceDate,
    dailyCloses: daily.bars.map((b) => ({ date: b.date, close: b.close })), rsi14: ind.rsi14.at(-1) ?? null, sma200: sma200Last, stage,
    avgCost: pos ? pos.avgCostCcy : null, fairValue: fairValueBase,
    nextEarnings: earnings[0] ? { date: earnings[0].reportDate.toISOString().slice(0, 10), estimated: earnings[0].dateIsEstimated } : null,
    earningsDataAvailable: earningsAny,
    recentDowngrades: actions.length ? recentActs.filter((a) => a.action === "DOWNGRADE").length : null,
    market: { indexLabel: "S&P 500 (SPY)", indexDrawdownPct: spy?.drawdownPct ?? null, pctBelow200: effBreadth.pctBelow, breadthEvaluated: effBreadth.evaluated },
    cashQuotaPct: portfolio.result.cashQuotaPct, thesisIntact,
  }, cfg);

  const components = buildComponents({
    assetType: inst.assetType, businessModel: inst.businessModel, price, priceDate, stage, sma200: sma200Last, rsi14: ind.rsi14.at(-1) ?? null, inGoldenPocket,
    fairValueBase, pegValue: pegR.value, fcfYieldPct: fcfYieldPct(fcf, marketCap), revenueGrowthPct: revGrowth, prevRevenueGrowthPct: prevRevGrowth,
    netIncomePositive: ni[0] ? ni[0].value > 0 : null, sbcToRevenuePct: sbc[0] && rev[0] ? (sbc[0].value / rev[0].value) * 100 : null,
    fundamentalsAsOf: rev[0]?.filedAt?.toISOString().slice(0, 10) ?? null,
    breadthPctAbove: effBreadth.pctBelow != null ? 100 - effBreadth.pctBelow : null, breadthEvaluated: effBreadth.representative ? Math.max(20, effBreadth.evaluated) : effBreadth.evaluated, indexAbove30w: spy?.last != null && spy.ma30w != null ? spy.last > spy.ma30w : null, relStrength26wPct: inst.symbol === "SPY" ? null : rel26,
    assetClassFlow20d: flows20 && flows20._count > 0 ? flows20._sum.netFlow : null,
    institutionalNetShares: instSummary?.netSharesChange ?? null, institutionalMixedPeriods: instSummary?.mixedPeriods ?? false,
    estimateRevisionsUp30d: fwd.fy1?.revisionsUp30d ?? null, estimateRevisionsDown30d: fwd.fy1?.revisionsDown30d ?? null, estimateRevision30dPct: fwd.revision30dPct, recentDowngrades: actions.length ? recentActs.filter((a) => a.action === "DOWNGRADE").length : null, recentUpgrades: actions.length ? recentActs.filter((a) => a.action === "UPGRADE").length : null,
    weightPct: pos?.weightPct ?? (pos ? null : 0), maxWeightPct: inst.meta?.maxWeightPct ?? general.maxPositionWeightPct, targetWeightPct: inst.meta?.targetWeightPct ?? null, cashQuotaPct: portfolio.result.cashQuotaPct, sectorWeightPct: sectorWeight,
  }, cfg);
  const score = aggregateScore(components, weights, rules, { isHeld: !!pos, thesisIntact, minCompleteness: cfg.minScoreCompleteness });

  const chart = daily.bars.length >= 30
    ? daily.bars.slice(-260).map((b, i, arr) => { const k = daily.bars.length - arr.length + i; return { date: b.date, close: b.close, sma50: ind.sma50[k] ?? null, sma200: ind.sma200[k] ?? null, ema20: ind.ema20[k] ?? null, rsi14: ind.rsi14[k] ?? null, rsi5: ind.rsi5[k] ?? null, volume: b.volume ?? null }; })
    : [];
  const rsiW = ind.rsi14w;
  const weeklyChart = weeklyBars.slice(-260).map((b, i, arr) => { const k = weeklyBars.length - arr.length + i; return { date: b.date, close: b.close, sma30w: ind.sma30w[k] ?? null, sma200w: ind.sma200w[k] ?? null, rsi14w: rsiW[k] ?? null }; });

  const backtests = [
    { label: `RSI 14 (Tage) < ${cfg.rsiOversold}, Haltedauer 20 Handelstage`, r: daily.bars.length >= 200 ? eventBacktest(daily.bars, below(ind.rsi14, cfg.rsiOversold), { holdBars: 20, adjusted: dailySafe }) : null, note: `${daily.bars.length} Tageskurse – mindestens 200 nötig` },
    { label: `RSI 14 (Wochen) < ${cfg.rsiOversold}, Haltedauer 13 Wochen`, r: weeklyBars.length >= 100 ? eventBacktest(weeklyBars, below(ind.rsi14w, cfg.rsiOversold), { holdBars: 13, adjusted: weeklySafe }) : null, note: `${weeklyBars.length} Wochenkurse – mindestens 100 nötig` },
  ];

  return {
    inst, today, general, cfg, price, priceDate, position: pos, priceInfo, backtests,
    dailyMeta: seriesMeta(daily, today, "daily"), weeklyMeta: { ...seriesMeta(weeklyDb.bars.length ? weeklyDb : { ...daily, bars: weeklyBars }, today, "weekly"), source: weeklySource },
    indicators: {
      sma50: ind.sma50.at(-1) ?? null, sma100: ind.sma100.at(-1) ?? null, sma200: sma200Last, ema10: ind.ema10.at(-1) ?? null, ema20: ind.ema20.at(-1) ?? null,
      rsi14: ind.rsi14.at(-1) ?? null, rsi5: ind.rsi5.at(-1) ?? null, sma30w: ind.sma30w.at(-1) ?? null, sma200w: ind.sma200w.at(-1) ?? null, rsi14w: rsiW.at(-1) ?? null,
      dist50: price != null ? distancePct(price, ind.sma50.at(-1) ?? null) : null, dist200: price != null ? distancePct(price, sma200Last) : null,
      dist30w: price != null ? distancePct(price, ind.sma30w.at(-1) ?? null) : null, dist200w: price != null ? distancePct(price, ind.sma200w.at(-1) ?? null) : null,
      adr: adr(daily.bars, 20), upDown: upDownVolume(daily.bars, 50), vol: annualizedVolatility(dc.slice(-253), inst.assetType === "CRYPTO" ? 365 : 252),
      volWeekly: annualizedVolatility(wc.slice(-53), 52),
    },
    stage, fib, fibConfluence: fib ? confluence(fib.levels, sma200Last) : [], zones, roundLevels: price != null ? roundLevels(price) : [], crosses: crosses.slice(-5), splits: { daily: splitsDaily, weekly: splitsWeekly }, splitInfo,
    fundamentals: {
      revenue: rev.slice(0, 4), netIncome: ni.slice(0, 4), ocf: ocf[0] ?? null, capex: capex[0] ?? null, fcf, sbc: sbc[0] ?? null, shares: sh.slice(0, 3), buybacks: buy[0] ?? null,
      revGrowth, prevRevGrowth, dilution, marketCap, fcfYield: fcfYieldPct(fcf, marketCap), forwardPe, forwardPeSource, peg: pegR, growthForPeg,
      estimates: { fwd, meta: estMeta, all: [...estByPeriod.values()].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1)).slice(0, 8) },
      cash: fund.find((f) => f.metric === "CASH") ?? null, debt: fund.find((f) => f.metric === "LONG_TERM_DEBT") ?? null,
      suitability: metricSuitability((inst.businessModel as BusinessModel) ?? "STANDARD"),
      count: fund.length,
    },
    valuation: { assumptions, scenarios, fairValueBase, modelNote: vm?.note ?? null, updatedAt: vm?.updatedAt ?? null, currencyMismatch: assumptions ? assumptions.currency !== inst.currency : false },
    earnings, actions, insider, insiderSummary, instSummary: instSummary ?? null, politicians, rules, score, chart, weeklyChart,
    market: { spy, breadth: breadth.current, rel26 },
  };
}

export type AssetAnalysis = NonNullable<Awaited<ReturnType<typeof analyzeAsset>>>;
