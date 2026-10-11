import { describe, expect, it } from "vitest";
import { evaluateRules, type RuleContext } from "@/lib/rules/engine";
import { DEFAULT_RULE_CONFIG, DEFAULT_SCORE_WEIGHTS, RuleConfigSchema } from "@/lib/rules/config";
import { aggregateScore, componentFromFactors, type ComponentScore } from "@/lib/score/score";

const flat = (n: number, v = 100) => Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close: v }));

const baseCtx = (o: Partial<RuleContext> = {}): RuleContext => ({
  symbol: "TEST", assetType: "STOCK", today: "2026-10-11", isHeld: false,
  price: 100, priceDate: "2026-10-09", dailyCloses: flat(30), rsi14: 50, sma200: null, stage: null,
  avgCost: null, fairValue: null, nextEarnings: null, earningsDataAvailable: true, recentDowngrades: null,
  market: { indexLabel: "SPY", indexDrawdownPct: -5, pctBelow200: 40, breadthEvaluated: 50 },
  cashQuotaPct: 10, thesisIntact: null, ...o,
});
const get = (e: ReturnType<typeof evaluateRules>, id: string) => e.outcomes.find((o) => o.id === id)!;

describe("Regel A – Marktlage", () => {
  it("Warnung bei Index nahe Hoch und > 50 % unter SMA200", () => {
    const e = evaluateRules(baseCtx({ market: { indexLabel: "SPY", indexDrawdownPct: -1, pctBelow200: 55, breadthEvaluated: 40 } }), DEFAULT_RULE_CONFIG);
    expect(get(e, "A1_MARKTBREITE_SCHWACH").status).toBe("AUSGELÖST");
    expect(get(e, "A2_CASHQUOTE_ORIENTIERUNG").status).toBe("AUSGELÖST");
  });
  it("genau 50 % löst nicht aus (> 50 % gefordert)", () => {
    const e = evaluateRules(baseCtx({ market: { indexLabel: "SPY", indexDrawdownPct: -1, pctBelow200: 50, breadthEvaluated: 40 } }), DEFAULT_RULE_CONFIG);
    expect(get(e, "A1_MARKTBREITE_SCHWACH").status).toBe("NICHT_AUSGELÖST");
  });
  it("Rücksetzer ≥ 10 % → Prüfhinweis, kein Kaufsignal", () => {
    const e = evaluateRules(baseCtx({ market: { indexLabel: "SPY", indexDrawdownPct: -11, pctBelow200: 60, breadthEvaluated: 40 } }), DEFAULT_RULE_CONFIG);
    const a3 = get(e, "A3_MARKTRUECKSETZER");
    expect(a3.status).toBe("AUSGELÖST");
    expect(a3.direction).toBe("PRÜFEN");
  });
  it("fehlende Marktbreite → DATEN_FEHLEN statt neutral", () => {
    const e = evaluateRules(baseCtx({ market: { indexLabel: "SPY", indexDrawdownPct: null, pctBelow200: null, breadthEvaluated: 0 } }), DEFAULT_RULE_CONFIG);
    expect(get(e, "A1_MARKTBREITE_SCHWACH").status).toBe("DATEN_FEHLEN");
    expect(e.missing.map((m) => m.id)).toContain("A1_MARKTBREITE_SCHWACH");
  });
});

describe("Regel B – Anstiege und Rücksetzer", () => {
  it("+25 % in 20 Tagen → nicht hinterherkaufen", () => {
    const closes = [...flat(10, 100), ...Array.from({ length: 15 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, "0")}`, close: 100 + (i + 1) * 1.7 }))];
    expect(get(evaluateRules(baseCtx({ dailyCloses: closes }), DEFAULT_RULE_CONFIG), "B1_NICHT_HINTERHERKAUFEN").status).toBe("AUSGELÖST");
  });
  it("Abverkauf vor 1 Tag → Wartezeit läuft", () => {
    const closes = [...flat(10, 100), { date: "2026-10-09", close: 85 }, { date: "2026-10-10", close: 84 }];
    const e = evaluateRules(baseCtx({ dailyCloses: closes, today: "2026-10-11", recentDowngrades: 2 }), DEFAULT_RULE_CONFIG);
    const b2 = get(e, "B2_ABVERKAUF_ABWARTEN");
    expect(b2.status).toBe("AUSGELÖST");
    expect(b2.message).toContain("2 Herabstufung");
  });
  it("Nachkaufmarken −15 % / −30 % und Rule of 20 nur bei Bestand", () => {
    expect(get(evaluateRules(baseCtx({ isHeld: true, avgCost: 100, price: 84 }), DEFAULT_RULE_CONFIG), "B3_NACHKAUFMARKE").status).toBe("AUSGELÖST");
    expect(get(evaluateRules(baseCtx({ isHeld: true, avgCost: 100, price: 90 }), DEFAULT_RULE_CONFIG), "B3_NACHKAUFMARKE").status).toBe("NICHT_AUSGELÖST");
    expect(get(evaluateRules(baseCtx({ isHeld: true, avgCost: 100, price: 79 }), DEFAULT_RULE_CONFIG), "B4_RULE_OF_20").status).toBe("AUSGELÖST");
    expect(get(evaluateRules(baseCtx({ isHeld: false, avgCost: 100, price: 70 }), DEFAULT_RULE_CONFIG), "B3_NACHKAUFMARKE").status).toBe("NICHT_ANWENDBAR");
  });
});

describe("Regel C/D und Konflikte", () => {
  it("RSI-Schwellen konfigurierbar", () => {
    const cfg = RuleConfigSchema.parse({ rsiOversold: 35 });
    expect(get(evaluateRules(baseCtx({ rsi14: 33 }), cfg), "C1_RSI_UEBERVERKAUFT").status).toBe("AUSGELÖST");
    expect(get(evaluateRules(baseCtx({ rsi14: 33 }), DEFAULT_RULE_CONFIG), "C1_RSI_UEBERVERKAUFT").status).toBe("NICHT_AUSGELÖST");
  });
  it("Quartalszahlen in 7 Tagen (Termin geschätzt) → Warnung", () => {
    const e = evaluateRules(baseCtx({ nextEarnings: { date: "2026-10-18", estimated: true } }), DEFAULT_RULE_CONFIG);
    expect(get(e, "D2_QUARTALSZAHLEN").message).toContain("Termin geschätzt");
  });
  it("Konflikt: Rücksetzer + RSI < 30, aber Stage 4, vor Zahlen und über Fair Value", () => {
    const e = evaluateRules(baseCtx({
      isHeld: true, avgCost: 140, price: 100, rsi14: 25, fairValue: 80,
      stage: { stage: 4, label: "Stage 4 – Abwärtstrend", ma30w: 120, slopePct: -3, priceVsMaPct: -17, reclaimed: false, confidence: "mittel", method: "" },
      nextEarnings: { date: "2026-10-15", estimated: false },
    }), DEFAULT_RULE_CONFIG);
    expect(e.pros.map((p) => p.id)).toContain("C1_RSI_UEBERVERKAUFT");
    expect(e.cons.map((p) => p.id)).toEqual(expect.arrayContaining(["C3_STAGE4", "D1_UEBER_FAIR_VALUE", "D2_QUARTALSZAHLEN"]));
    expect(e.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(e.conflicts.join(" ")).toContain("Stage 4");
    expect(e.blocksNewBuy).toBe(false); // bestehende Position: D1 blockiert nur Neukäufe
  });
  it("Kurs über Fair Value blockiert Neukauf", () => {
    expect(evaluateRules(baseCtx({ price: 120, fairValue: 100 }), DEFAULT_RULE_CONFIG).blocksNewBuy).toBe(true);
  });
  it("Krypto: Aktienregeln nicht anwendbar, Charttechnik als Dashboard-Erweiterung", () => {
    const e = evaluateRules(baseCtx({ assetType: "CRYPTO", rsi14: 20 }), DEFAULT_RULE_CONFIG);
    expect(get(e, "A1_MARKTBREITE_SCHWACH").status).toBe("NICHT_ANWENDBAR");
    expect(get(e, "D1_UEBER_FAIR_VALUE").status).toBe("NICHT_ANWENDBAR");
    const c1 = get(e, "C1_RSI_UEBERVERKAUFT");
    expect(c1.status).toBe("AUSGELÖST");
    expect(c1.origin).toBe("DASHBOARD_ERWEITERUNG");
  });
});

describe("Kaufsignalscore", () => {
  const comp = (key: ComponentScore["key"], score: number | null): ComponentScore => ({ key, score, factors: [], dataUsed: [], missing: [], asOf: null });
  const noRules = evaluateRules(baseCtx({ market: { indexLabel: "SPY", indexDrawdownPct: -5, pctBelow200: 40, breadthEvaluated: 50 } }), DEFAULT_RULE_CONFIG);

  it("fehlende Komponenten werden nicht als neutral gezählt; Gewichte transparent umverteilt", () => {
    const r = aggregateScore([comp("technical", 80), comp("fundamental", 60), comp("market", null), comp("operational", null), comp("flows", null), comp("sentiment", null), comp("portfolioFit", 70)], DEFAULT_SCORE_WEIGHTS, noRules, { isHeld: false, thesisIntact: null, minCompleteness: 0.5 });
    expect(r.completeness).toBeCloseTo(0.5, 10);
    expect(r.total).toBeCloseTo((80 * 20 + 60 * 20 + 70 * 10) / 50, 10);
    expect(r.effectiveWeights.technical).toBeCloseTo(40, 10);
    expect(r.effectiveWeights.market).toBeUndefined();
    expect(r.warnings.join(" ")).toContain("nicht als neutral");
  });
  it("zu geringe Vollständigkeit → Datenlage nicht ausreichend", () => {
    const r = aggregateScore([comp("technical", 90)], DEFAULT_SCORE_WEIGHTS, noRules, { isHeld: false, thesisIntact: null, minCompleteness: 0.5 });
    expect(r.state).toBe("DATENLAGE_NICHT_AUSREICHEND");
  });
  it("These verletzt hat Vorrang", () => {
    const all = (s: number) => (Object.keys(DEFAULT_SCORE_WEIGHTS) as ComponentScore["key"][]).map((k) => comp(k, s));
    expect(aggregateScore(all(90), DEFAULT_SCORE_WEIGHTS, noRules, { isHeld: true, thesisIntact: false, minCompleteness: 0.5 }).state).toBe("THESE_NEU_PRÜFEN");
    expect(aggregateScore(all(90), DEFAULT_SCORE_WEIGHTS, noRules, { isHeld: false, thesisIntact: null, minCompleteness: 0.5 }).state).toBe("MÖGLICHER_EINSTIEG");
    expect(aggregateScore(all(30), DEFAULT_SCORE_WEIGHTS, noRules, { isHeld: false, thesisIntact: null, minCompleteness: 0.5 }).state).toBe("ABWARTEN");
  });
  it("Komponente aus Faktoren: Basis 50, begrenzt auf 0–100, ohne Faktoren null", () => {
    expect(componentFromFactors("technical", [{ label: "a", points: 80, value: "" }], [], [], null).score).toBe(100);
    expect(componentFromFactors("technical", [{ label: "a", points: -10, value: "" }], [], [], null).score).toBe(40);
    expect(componentFromFactors("technical", [], [], ["x"], null).score).toBeNull();
  });
});

describe("Nicht anwendbare Komponenten", () => {
  it("werden aus der Gewichtung genommen, aber nicht als fehlend gezählt", () => {
    const e = evaluateRules(baseCtx({ assetType: "CRYPTO" }), DEFAULT_RULE_CONFIG);
    const c = (key: ComponentScore["key"], score: number | null, notApplicable = false): ComponentScore => ({ key, score, factors: [], dataUsed: [], missing: [], asOf: null, notApplicable });
    const r = aggregateScore([c("technical", 60), c("fundamental", null, true), c("market", 60), c("operational", null), c("flows", null), c("sentiment", null), c("portfolioFit", 60)], DEFAULT_SCORE_WEIGHTS, e, { isHeld: true, thesisIntact: null, minCompleteness: 0.5 });
    expect(r.completeness).toBeCloseTo(45 / 80, 10);
    expect(r.warnings.join(" ")).toContain("Nicht anwendbar");
  });
});
