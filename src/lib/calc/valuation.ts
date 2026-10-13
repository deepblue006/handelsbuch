/**
 * Bewertung: Fair-Value-Szenarien, Rückwärtsrechnung, PEG, FCF-Rendite, EV/Sales.
 * Alle Annahmen sind Eingaben des Nutzers bzw. sichtbar dokumentierte Datenpunkte.
 * Ergebnisse sind Modellwerte mit großer Unsicherheit – keine Kursziele im Sinne einer Prognose.
 */

export interface ScenarioAssumptions {
  label: "konservativ" | "basis" | "optimistisch";
  revenueGrowthPct: number; // jährliches Umsatzwachstum
  netMarginPct: number; // Nettomarge im Zieljahr
  annualDilutionPct: number; // jährliche Veränderung der Aktienzahl (+ Verwässerung, − Rückkäufe)
  fairPe: number; // angenommenes faires KGV
}

export interface ValuationInputs {
  baseYear: number; // Geschäftsjahr der Ausgangswerte
  revenue: number; // Umsatz im Basisjahr (Berichtswährung)
  sharesOutstanding: number; // verwässerte Aktienanzahl im Basisjahr
  currency: string;
  discountRatePct?: number; // optional: Abzinsung des Zielwerts auf heute
}

export interface ScenarioResult {
  label: ScenarioAssumptions["label"];
  year: number;
  revenue: number;
  netIncome: number;
  shares: number;
  eps: number;
  fairValue: number; // nominal im Zieljahr
  presentValue: number | null; // abgezinst auf heute, falls Diskontsatz gesetzt
  assumptions: ScenarioAssumptions;
}

/** Fair Value je Aktie = geschätzter Gewinn je Aktie × angenommenes faires KGV, für ein Zieljahr. */
export function scenarioFairValue(inp: ValuationInputs, a: ScenarioAssumptions, targetYear: number): ScenarioResult {
  if (!(inp.revenue > 0) || !(inp.sharesOutstanding > 0)) throw new Error("Umsatz und Aktienzahl müssen positiv sein");
  const years = targetYear - inp.baseYear;
  if (years < 0) throw new Error("Zieljahr liegt vor dem Basisjahr");
  const revenue = inp.revenue * Math.pow(1 + a.revenueGrowthPct / 100, years);
  const netIncome = revenue * (a.netMarginPct / 100);
  const shares = inp.sharesOutstanding * Math.pow(1 + a.annualDilutionPct / 100, years);
  const eps = netIncome / shares;
  const fairValue = eps * a.fairPe;
  const presentValue = inp.discountRatePct != null ? fairValue / Math.pow(1 + inp.discountRatePct / 100, years) : null;
  return { label: a.label, year: targetYear, revenue, netIncome, shares, eps, fairValue, presentValue, assumptions: a };
}

/** Einfacher Referenzansatz: EPS-Schätzung × faires KGV. */
export function simpleFairValue(epsEstimate: number, fairPe: number): number | null {
  if (!Number.isFinite(epsEstimate) || !Number.isFinite(fairPe) || fairPe <= 0) return null;
  if (epsEstimate <= 0) return null; // negatives EPS → KGV-Ansatz ungeeignet
  return epsEstimate * fairPe;
}

/** Sensitivität: Fair Value für Variationen von KGV und Wachstum (Basisszenario). */
export function sensitivity(inp: ValuationInputs, a: ScenarioAssumptions, targetYear: number, peDeltas = [-5, 0, 5], growthDeltas = [-5, 0, 5]) {
  return growthDeltas.map((gd) => ({
    growthPct: a.revenueGrowthPct + gd,
    values: peDeltas.map((pd) => ({
      pe: a.fairPe + pd,
      fairValue: a.fairPe + pd > 0 ? scenarioFairValue(inp, { ...a, revenueGrowthPct: a.revenueGrowthPct + gd, fairPe: a.fairPe + pd }, targetYear).fairValue : null,
    })),
  }));
}

export interface ReverseValuationInput {
  marketCap: number; // aktueller Börsenwert (Berichtswährung)
  targetPe: number; // Ziel-KGV bei Reife
  matureNetMarginPct: number; // angenommene reife Nettomarge
  currentRevenue: number; // aktueller Jahresumsatz (TTM oder letztes GJ)
  expectedGrowthPct?: number; // optional: erwartetes Wachstum zur Zeitabschätzung
  requiredReturnPct?: number; // optional: gewünschte jährliche Rendite des Anlegers
  horizonYears?: number; // optional: Zeitraum, in dem die Rendite erzielt werden soll
}

export interface ReverseValuationResult {
  requiredNetIncome: number;
  requiredRevenue: number;
  revenueMultiple: number; // benötigter Umsatz / aktueller Umsatz
  yearsAtExpectedGrowth: number | null;
  impliedCagrForHorizon: number | null;
  targetMarketCap: number;
  formula: string;
}

/**
 * Rückwärtsrechnung „Was steckt im Kurs?“
 * Nötiger Gewinn = (Börsenwert · (1 + r)^N) ÷ Ziel-KGV
 * Nötiger Umsatz = Nötiger Gewinn ÷ reife Nettomarge
 * Jahre bei Wachstum g: n = ln(Nötiger Umsatz / aktueller Umsatz) ÷ ln(1 + g)
 * Implizites Wachstum über N Jahre: (Nötiger Umsatz / aktueller Umsatz)^(1/N) − 1
 */
export function reverseValuation(i: ReverseValuationInput): ReverseValuationResult {
  if (!(i.marketCap > 0) || !(i.targetPe > 0) || !(i.matureNetMarginPct > 0) || !(i.currentRevenue > 0)) {
    throw new Error("Börsenwert, Ziel-KGV, Marge und Umsatz müssen positiv sein");
  }
  const growthFactor = i.requiredReturnPct != null && i.horizonYears != null ? Math.pow(1 + i.requiredReturnPct / 100, i.horizonYears) : 1;
  const targetMarketCap = i.marketCap * growthFactor;
  const requiredNetIncome = targetMarketCap / i.targetPe;
  const requiredRevenue = requiredNetIncome / (i.matureNetMarginPct / 100);
  const multiple = requiredRevenue / i.currentRevenue;
  let years: number | null = null;
  if (i.expectedGrowthPct != null && i.expectedGrowthPct > 0) {
    years = multiple <= 1 ? 0 : Math.log(multiple) / Math.log(1 + i.expectedGrowthPct / 100);
  }
  const impliedCagr = i.horizonYears != null && i.horizonYears > 0 ? (Math.pow(multiple, 1 / i.horizonYears) - 1) * 100 : null;
  return {
    requiredNetIncome,
    requiredRevenue,
    revenueMultiple: multiple,
    yearsAtExpectedGrowth: years,
    impliedCagrForHorizon: impliedCagr,
    targetMarketCap,
    formula: "Umsatz_nötig = (Börsenwert × (1+r)^N ÷ Ziel-KGV) ÷ Nettomarge",
  };
}

/** PEG = KGV ÷ erwartetes Gewinnwachstum in Prozentpunkten. Nicht definiert bei Wachstum ≤ 0 oder KGV ≤ 0. */
export function peg(pe: number | null, growthPct: number | null): { value: number | null; reason?: string } {
  if (pe == null || growthPct == null) return { value: null, reason: "KGV oder Wachstumsschätzung fehlt" };
  if (pe <= 0) return { value: null, reason: "KGV nicht positiv (Verlust) – PEG nicht aussagekräftig" };
  if (growthPct <= 0) return { value: null, reason: "Wachstum ≤ 0 – PEG nicht definiert" };
  return { value: pe / growthPct };
}

export type PegClass = "potenziell günstig" | "eher fair" | "möglicherweise teuer";
export function classifyPeg(v: number, cheapBelow = 1, expensiveAbove = 2): PegClass {
  if (v < cheapBelow) return "potenziell günstig";
  if (v <= expensiveAbove) return "eher fair";
  return "möglicherweise teuer";
}

export function fcfYieldPct(freeCashFlow: number | null, marketCap: number | null): number | null {
  if (freeCashFlow == null || marketCap == null || marketCap <= 0) return null;
  return (freeCashFlow / marketCap) * 100;
}

export function enterpriseValue(marketCap: number | null, totalDebt: number | null, cash: number | null): number | null {
  if (marketCap == null || totalDebt == null || cash == null) return null;
  return marketCap + totalDebt - cash;
}

export function evToSales(ev: number | null, revenue: number | null): number | null {
  if (ev == null || revenue == null || revenue <= 0) return null;
  return ev / revenue;
}

export function marginOfSafetyPct(price: number, fairValue: number | null): number | null {
  if (fairValue == null || fairValue <= 0) return null;
  return ((fairValue - price) / fairValue) * 100;
}

export type BusinessModel = "STANDARD" | "BANK" | "INSURANCE" | "REIT" | "COMMODITY" | "OTHER";

/** Hinweise, warum Standardkennzahlen für bestimmte Geschäftsmodelle ungeeignet sein können. */
export function metricSuitability(model: BusinessModel | null | undefined): { metric: string; reason: string }[] {
  switch (model) {
    case "BANK":
      return [
        { metric: "EV/Sales, freier Cashflow", reason: "Bei Banken sind Einlagen und Kredite operatives Geschäft; EV und FCF sind kaum sinnvoll definiert. Besser: KBV, Eigenkapitalrendite, CET1-Quote." },
        { metric: "Verschuldung", reason: "Hohe Bilanzverschuldung ist geschäftsmodelltypisch und nicht mit Industrieunternehmen vergleichbar." },
      ];
    case "INSURANCE":
      return [{ metric: "Umsatzwachstum, FCF", reason: "Prämienwachstum und Kapitalanlageergebnis prägen den Gewinn; Combined Ratio und Solvenzquote sind aussagekräftiger." }];
    case "REIT":
      return [{ metric: "KGV, GAAP-Gewinn", reason: "Abschreibungen auf Immobilien verzerren den GAAP-Gewinn; FFO/AFFO und NAV sind üblicher." }];
    case "COMMODITY":
      return [{ metric: "Umsatzwachstum, KGV", reason: "Ergebnisse folgen stark dem Rohstoffpreiszyklus; ein niedriges KGV kann am Zyklushoch auftreten." }];
    default:
      return [];
  }
}
