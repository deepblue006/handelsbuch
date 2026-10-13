/**
 * Score-Komponenten aus Analysedaten. Jede Regel ist hier sichtbar dokumentiert;
 * ohne Daten bleibt eine Komponente `null` (fehlend) – sie wird nie neutral gesetzt.
 */
import { componentFromFactors, type ComponentScore, type Factor } from "./score";
import type { RuleConfig } from "../rules/config";
import type { StageResult } from "../calc/indicators";
import { num, pct } from "../format";

export interface ComponentInputs {
  assetType: string;
  businessModel: string | null;
  price: number | null;
  priceDate: string | null;
  // Technik
  stage: StageResult | null;
  sma200: number | null;
  rsi14: number | null;
  inGoldenPocket: boolean | null;
  // Bewertung & Qualität
  fairValueBase: number | null;
  pegValue: number | null;
  fcfYieldPct: number | null;
  revenueGrowthPct: number | null;
  prevRevenueGrowthPct: number | null;
  netIncomePositive: boolean | null;
  sbcToRevenuePct: number | null;
  fundamentalsAsOf: string | null;
  // Markt
  breadthPctAbove: number | null;
  breadthEvaluated: number;
  indexAbove30w: boolean | null;
  relStrength26wPct: number | null; // Performance relativ zum Index über 26 Wochen
  // Flows / Sentiment
  assetClassFlow20d: number | null; // Mio. USD
  institutionalNetShares?: number | null; // 13F-basiert: Aktien bei Aufstockern − bei Reduzierern
  institutionalMixedPeriods?: boolean;
  estimateRevisionsUp30d?: number | null;
  estimateRevisionsDown30d?: number | null;
  estimateRevision30dPct?: number | null;
  recentDowngrades: number | null;
  recentUpgrades: number | null;
  // Portfolio
  weightPct: number | null;
  maxWeightPct: number | null;
  targetWeightPct: number | null;
  cashQuotaPct: number | null;
  sectorWeightPct: number | null;
}

const f = (label: string, points: number, value: string): Factor => ({ label, points, value });

export function buildComponents(x: ComponentInputs, cfg: RuleConfig): ComponentScore[] {
  const isCrypto = x.assetType === "CRYPTO";
  const standard = !x.businessModel || x.businessModel === "STANDARD";

  // --- Technik ---
  const t: Factor[] = [];
  const tMissing: string[] = [];
  if (x.stage?.stage) {
    const pts = { 1: x.stage.reclaimed ? 5 : 0, 2: 15, 3: -10, 4: -20 }[x.stage.stage];
    t.push(f(x.stage.label + (x.stage.reclaimed ? " (30W zurückerobert)" : ""), pts, `Steigung ${pct(x.stage.slopePct)}`));
  } else tMissing.push("Stage-Analyse (Wochenkurse)");
  if (x.sma200 != null && x.price != null) t.push(f(x.price >= x.sma200 ? "Kurs über 200-Tage-Linie" : "Kurs unter 200-Tage-Linie", x.price >= x.sma200 ? 10 : -10, pct(((x.price - x.sma200) / x.sma200) * 100)));
  else tMissing.push("200-Tage-Linie");
  if (x.rsi14 != null) {
    const p = x.rsi14 < cfg.rsiOversold ? 10 : x.rsi14 > cfg.rsiOverbought ? -10 : 0;
    t.push(f(p > 0 ? "RSI 14 überverkauft (gestaffelt prüfen)" : p < 0 ? "RSI 14 überkauft" : "RSI 14 neutral", p, num(x.rsi14, 1)));
  } else tMissing.push("RSI 14");
  if (x.inGoldenPocket) t.push(f("Kurs in Fibonacci-Golden-Pocket", 5, "0,618–0,65"));

  // --- Bewertung & Qualität ---
  const q: Factor[] = [];
  const qMissing: string[] = [];
  if (!isCrypto) {
    if (x.fairValueBase != null && x.price != null) {
      const mos = ((x.fairValueBase - x.price) / x.fairValueBase) * 100;
      q.push(f(mos > 20 ? "Deutlich unter Fair Value (Basis)" : mos >= 0 ? "Unter Fair Value (Basis)" : "Über Fair Value (Basis)", mos > 20 ? 20 : mos >= 0 ? 10 : -20, `Sicherheitsmarge ${pct(mos)}`));
    } else qMissing.push("Fair-Value-Modell");
    if (x.pegValue != null) q.push(f(x.pegValue < cfg.pegCheapBelow ? "PEG potenziell günstig" : x.pegValue > cfg.pegExpensiveAbove ? "PEG möglicherweise teuer" : "PEG eher fair", x.pegValue < cfg.pegCheapBelow ? 10 : x.pegValue > cfg.pegExpensiveAbove ? -10 : 0, num(x.pegValue, 2)));
    else qMissing.push("PEG (KGV + Wachstumsschätzung)");
    if (standard) {
      if (x.fcfYieldPct != null) q.push(f(x.fcfYieldPct >= cfg.fcfYieldInterestingPct ? "FCF-Rendite interessant" : x.fcfYieldPct < 0 ? "Negativer freier Cashflow" : "FCF-Rendite niedrig", x.fcfYieldPct >= cfg.fcfYieldInterestingPct ? 10 : x.fcfYieldPct < 0 ? -10 : 0, pct(x.fcfYieldPct)));
      else qMissing.push("FCF-Rendite");
      if (x.revenueGrowthPct != null) q.push(f(x.revenueGrowthPct >= cfg.revenueGrowthTargetLowPct ? "Umsatzwachstum im Zielbereich" : x.revenueGrowthPct >= cfg.revenueGrowthMinPct ? "Umsatzwachstum ≥ Mindestwert" : x.revenueGrowthPct < 0 ? "Umsatz rückläufig" : "Umsatzwachstum unter Mindestwert", x.revenueGrowthPct >= cfg.revenueGrowthTargetLowPct ? 10 : x.revenueGrowthPct >= cfg.revenueGrowthMinPct ? 5 : x.revenueGrowthPct < 0 ? -10 : -5, pct(x.revenueGrowthPct)));
      else qMissing.push("Umsatzwachstum");
    }
    if (x.netIncomePositive != null) q.push(f(x.netIncomePositive ? "GAAP-Gewinn positiv" : "GAAP-Verlust", x.netIncomePositive ? 5 : -10, x.netIncomePositive ? "ja" : "nein"));
    else qMissing.push("GAAP-Gewinn");
    if (x.sbcToRevenuePct != null && x.sbcToRevenuePct > 10) q.push(f("Hohe Aktienvergütung (SBC)", -5, `${pct(x.sbcToRevenuePct, 1, false)} vom Umsatz`));
  }

  // --- Markt ---
  const m: Factor[] = [];
  const mMissing: string[] = [];
  if (!isCrypto) {
    if (x.breadthPctAbove != null && x.breadthEvaluated >= 20) m.push(f(x.breadthPctAbove > 60 ? "Breite Marktbeteiligung" : x.breadthPctAbove < 40 ? "Schwache Marktbreite" : "Marktbreite gemischt", x.breadthPctAbove > 60 ? 10 : x.breadthPctAbove < 40 ? -15 : 0, `${pct(x.breadthPctAbove, 0, false)} über SMA200 (${x.breadthEvaluated} Titel)`));
    else mMissing.push("Marktbreite (≥ 20 auswertbare Titel)");
  }
  if (x.indexAbove30w != null) m.push(f(x.indexAbove30w ? "Leitindex über 30-Wochen-Linie" : "Leitindex unter 30-Wochen-Linie", x.indexAbove30w ? 5 : -10, x.indexAbove30w ? "ja" : "nein"));
  else mMissing.push("Indextrend");
  if (x.relStrength26wPct != null) m.push(f(x.relStrength26wPct >= 0 ? "Relativ stärker als Index (26 W)" : "Relativ schwächer als Index (26 W)", x.relStrength26wPct >= 0 ? 10 : -10, pct(x.relStrength26wPct)));
  else mMissing.push("Relative Stärke");

  // --- Operativ / On-Chain ---
  const o: Factor[] = [];
  const oMissing: string[] = [];
  if (isCrypto) oMissing.push("On-Chain-Kennzahlen (keine Quelle angebunden)");
  else if (x.revenueGrowthPct != null && x.prevRevenueGrowthPct != null) {
    const acc = x.revenueGrowthPct - x.prevRevenueGrowthPct;
    o.push(f(acc >= 0 ? "Wachstum beschleunigt sich" : "Wachstum verlangsamt sich", acc >= 0 ? 10 : -10, `${num(acc, 1)} Prozentpunkte`));
  } else oMissing.push("Wachstumsverlauf (zwei Geschäftsjahre)");

  // --- Flows ---
  const fl: Factor[] = [];
  const flMissing: string[] = [];
  if (x.assetClassFlow20d != null) fl.push(f(x.assetClassFlow20d >= 0 ? "ETF-Nettozuflüsse (20 Tage)" : "ETF-Nettoabflüsse (20 Tage)", x.assetClassFlow20d >= 0 ? 10 : -10, `${num(x.assetClassFlow20d, 1)} Mio. USD`));
  if (x.institutionalNetShares != null) fl.push(f(x.institutionalNetShares >= 0 ? "13F: mehr Aktien bei aufstockenden Institutionen" : "13F: mehr Aktien bei reduzierenden Institutionen", x.institutionalNetShares >= 0 ? 5 : -5, `${num(x.institutionalNetShares / 1e6, 1)} Mio. Aktien netto${x.institutionalMixedPeriods ? ", gemischte Stichtage, verzögert" : ", verzögert"}`));
  if (!fl.length) flMissing.push("Institutionelle Flüsse");

  // --- Sentiment ---
  const s: Factor[] = [];
  const sMissing: string[] = [];
  if (x.recentDowngrades != null || x.recentUpgrades != null) {
    const d = x.recentDowngrades ?? 0, u = x.recentUpgrades ?? 0;
    s.push(f(d > u ? "Mehr Herabstufungen als Heraufstufungen" : u > d ? "Mehr Heraufstufungen (Erwartungen evtl. eingepreist)" : "Analystenstimmung ausgeglichen", d > u ? -10 : 0, `${u} hoch / ${d} runter`));
  } else sMissing.push("Analystenmaßnahmen");
  if (x.estimateRevisionsUp30d != null || x.estimateRevisionsDown30d != null) {
    const u = x.estimateRevisionsUp30d ?? 0, d = x.estimateRevisionsDown30d ?? 0;
    s.push(f(u > d ? "Gewinnschätzungen überwiegend angehoben (30 T.)" : d > u ? "Gewinnschätzungen überwiegend gesenkt (30 T.)" : "Schätzungsrevisionen ausgeglichen", u > d ? 5 : d > u ? -10 : 0, `${u} hoch / ${d} runter${x.estimateRevision30dPct != null ? `, Ø ${pct(x.estimateRevision30dPct, 2)}` : ""}`));
  }

  // --- Portfolio-Fit ---
  const p: Factor[] = [];
  const pMissing: string[] = [];
  if (x.weightPct != null || x.maxWeightPct != null) {
    const w = x.weightPct ?? 0;
    if (x.maxWeightPct != null && w >= x.maxWeightPct) p.push(f("Position an/über Obergrenze", -20, `${pct(w, 1, false)} ≥ ${pct(x.maxWeightPct, 0, false)}`));
    else if (x.targetWeightPct != null && w < x.targetWeightPct) p.push(f("Unter Zielgewicht", 10, `${pct(w, 1, false)} < ${pct(x.targetWeightPct, 0, false)}`));
    else p.push(f("Gewicht innerhalb der Grenzen", 0, pct(w, 1, false)));
  } else pMissing.push("Gewichtsgrenzen");
  if (x.cashQuotaPct != null) p.push(f(x.cashQuotaPct >= cfg.referenceCashQuotaPct ? "Liquidität vorhanden" : "Cashquote unter Referenz", x.cashQuotaPct >= cfg.referenceCashQuotaPct ? 5 : -5, pct(x.cashQuotaPct, 1, false)));
  else pMissing.push("Cashquote");
  if (x.sectorWeightPct != null && x.sectorWeightPct > 40) p.push(f("Hohe Sektorkonzentration", -10, pct(x.sectorWeightPct, 1, false)));

  return [
    componentFromFactors("technical", t, ["Tages-/Wochenkurse"], tMissing, x.priceDate),
    { ...componentFromFactors("fundamental", q, ["SEC-Finanzdaten / Bewertungsmodell"], isCrypto ? [] : qMissing, x.fundamentalsAsOf), notApplicable: isCrypto },
    componentFromFactors("market", m, ["Marktbreite", "Indexkurse"], mMissing, x.priceDate),
    componentFromFactors("operational", o, isCrypto ? [] : ["Umsatzverlauf"], oMissing, x.fundamentalsAsOf),
    componentFromFactors("flows", fl, ["ETF-Flows"], flMissing, null),
    componentFromFactors("sentiment", s, ["Analystenmaßnahmen"], sMissing, null),
    componentFromFactors("portfolioFit", p, ["Portfolio", "Einstellungen"], pMissing, null),
  ];
}
