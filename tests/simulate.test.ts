import { describe, expect, it } from "vitest";
import { shockScenario, simulateBuy, nextPlanDates } from "@/lib/calc/simulate";

const pos = [{ symbol: "NVDA", valueBase: 4000, tags: ["KI"] }, { symbol: "WELT", valueBase: 5000, tags: [] }];

describe("Simulationen (keine Orders)", () => {
  it("Marktrücksetzer mit KI-Stressszenario", () => {
    const r = shockScenario(pos, 1000, -10, { tag: "KI", shockPct: -35 });
    expect(r.rows.find((x) => x.symbol === "NVDA")!.after).toBeCloseTo(2600, 8);
    expect(r.totalAfter).toBeCloseTo(2600 + 4500 + 1000, 8);
    expect(r.cashQuotaAfter!).toBeCloseTo((1000 / 8100) * 100, 8);
  });
  it("hypothetischer Kauf verändert Gewichte und Cashquote", () => {
    const r = simulateBuy(pos, 1000, "NVDA", 500);
    expect(r.cashAfter).toBe(500);
    expect(r.weights[0]).toEqual({ symbol: "WELT", weightPct: 50 });
    expect(r.cashQuotaAfter).toBe(5);
    expect(() => simulateBuy(pos, 100, "X", 500)).toThrow(/Liquidität/);
  });
  it("Sparplantermine", () => {
    expect(nextPlanDates("2025-01-15", 15, "MONTHLY", "2026-10-13")).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
    expect(nextPlanDates("2026-01-31", 31, "QUARTERLY", "2026-02-01", 2)).toEqual(["2026-04-28", "2026-07-28"]);
  });
});
