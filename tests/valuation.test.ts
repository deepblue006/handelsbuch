import { describe, expect, it } from "vitest";
import { scenarioFairValue, simpleFairValue, reverseValuation, peg, classifyPeg, fcfYieldPct, enterpriseValue, evToSales, marginOfSafetyPct, sensitivity, metricSuitability } from "@/lib/calc/valuation";

const inp = { baseYear: 2025, revenue: 1000, sharesOutstanding: 100, currency: "USD" };

describe("Fair-Value-Szenarien", () => {
  it("Fair Value = EPS × faires KGV mit Wachstum, Marge und Verwässerung", () => {
    const r = scenarioFairValue(inp, { label: "basis", revenueGrowthPct: 10, netMarginPct: 20, annualDilutionPct: 1, fairPe: 25 }, 2027);
    const revenue = 1000 * 1.1 ** 2;
    const shares = 100 * 1.01 ** 2;
    expect(r.revenue).toBeCloseTo(revenue, 8);
    expect(r.eps).toBeCloseTo((revenue * 0.2) / shares, 8);
    expect(r.fairValue).toBeCloseTo(((revenue * 0.2) / shares) * 25, 8);
    expect(r.presentValue).toBeNull();
  });
  it("Abzinsung optional", () => {
    const r = scenarioFairValue({ ...inp, discountRatePct: 10 }, { label: "basis", revenueGrowthPct: 0, netMarginPct: 10, annualDilutionPct: 0, fairPe: 10 }, 2027);
    expect(r.fairValue).toBeCloseTo(10, 8);
    expect(r.presentValue).toBeCloseTo(10 / 1.21, 8);
  });
  it("konservativ < Basis < optimistisch", () => {
    const k = scenarioFairValue(inp, { label: "konservativ", revenueGrowthPct: 5, netMarginPct: 15, annualDilutionPct: 2, fairPe: 18 }, 2030).fairValue;
    const b = scenarioFairValue(inp, { label: "basis", revenueGrowthPct: 10, netMarginPct: 20, annualDilutionPct: 1, fairPe: 25 }, 2030).fairValue;
    const o = scenarioFairValue(inp, { label: "optimistisch", revenueGrowthPct: 15, netMarginPct: 25, annualDilutionPct: 0, fairPe: 30 }, 2030).fairValue;
    expect(k).toBeLessThan(b);
    expect(b).toBeLessThan(o);
  });
  it("ungültige Eingaben werden abgelehnt", () => {
    expect(() => scenarioFairValue({ ...inp, revenue: 0 }, { label: "basis", revenueGrowthPct: 1, netMarginPct: 1, annualDilutionPct: 0, fairPe: 1 }, 2026)).toThrow();
    expect(() => scenarioFairValue(inp, { label: "basis", revenueGrowthPct: 1, netMarginPct: 1, annualDilutionPct: 0, fairPe: 1 }, 2020)).toThrow();
  });
  it("einfacher Ansatz; negatives EPS → nicht anwendbar", () => {
    expect(simpleFairValue(5, 20)).toBe(100);
    expect(simpleFairValue(-1, 20)).toBeNull();
  });
  it("Sensitivitätstabelle", () => {
    const s = sensitivity(inp, { label: "basis", revenueGrowthPct: 10, netMarginPct: 20, annualDilutionPct: 0, fairPe: 25 }, 2027);
    expect(s).toHaveLength(3);
    expect(s[1]!.values[1]!.fairValue).toBeCloseTo(scenarioFairValue(inp, { label: "basis", revenueGrowthPct: 10, netMarginPct: 20, annualDilutionPct: 0, fairPe: 25 }, 2027).fairValue, 8);
  });
});

describe("Rückwärtsrechnung", () => {
  it("nötiger Umsatz = Börsenwert ÷ Ziel-KGV ÷ Nettomarge", () => {
    const r = reverseValuation({ marketCap: 1_000_000, targetPe: 25, matureNetMarginPct: 20, currentRevenue: 100_000, expectedGrowthPct: 20 });
    expect(r.requiredNetIncome).toBeCloseTo(40_000, 6);
    expect(r.requiredRevenue).toBeCloseTo(200_000, 6);
    expect(r.revenueMultiple).toBeCloseTo(2, 10);
    expect(r.yearsAtExpectedGrowth).toBeCloseTo(Math.log(2) / Math.log(1.2), 8);
  });
  it("mit Renditeerwartung und Horizont", () => {
    const r = reverseValuation({ marketCap: 100, targetPe: 10, matureNetMarginPct: 10, currentRevenue: 100, requiredReturnPct: 10, horizonYears: 5 });
    expect(r.requiredRevenue).toBeCloseTo(100 * 1.1 ** 5, 8);
    expect(r.impliedCagrForHorizon).toBeCloseTo(10, 8);
  });
  it("bereits erreicht → 0 Jahre", () => {
    expect(reverseValuation({ marketCap: 100, targetPe: 10, matureNetMarginPct: 10, currentRevenue: 500, expectedGrowthPct: 5 }).yearsAtExpectedGrowth).toBe(0);
  });
});

describe("Kennzahlen", () => {
  it("PEG und Einordnung", () => {
    expect(peg(30, 15).value).toBe(2);
    expect(peg(30, 0).value).toBeNull();
    expect(peg(-5, 10).reason).toContain("Verlust");
    expect(classifyPeg(0.8)).toBe("potenziell günstig");
    expect(classifyPeg(1.5)).toBe("eher fair");
    expect(classifyPeg(2.5)).toBe("möglicherweise teuer");
  });
  it("FCF-Rendite, EV, EV/Sales, Sicherheitsmarge", () => {
    expect(fcfYieldPct(40, 1000)).toBe(4);
    expect(fcfYieldPct(null, 1000)).toBeNull();
    expect(enterpriseValue(1000, 200, 50)).toBe(1150);
    expect(enterpriseValue(1000, null, 50)).toBeNull();
    expect(evToSales(1150, 115)).toBe(10);
    expect(marginOfSafetyPct(80, 100)).toBe(20);
  });
  it("Hinweise zu ungeeigneten Kennzahlen je Geschäftsmodell", () => {
    expect(metricSuitability("BANK").length).toBeGreaterThan(0);
    expect(metricSuitability("REIT")[0]!.reason).toContain("FFO");
    expect(metricSuitability("STANDARD")).toEqual([]);
  });
});
