import { describe, expect, it } from "vitest";
import { parseEarningsEstimates, forwardEstimates, parseInsiderTransactions, parseInstitutionalHoldings, parseEconomic } from "@/lib/providers/alphavantage";
import { loadSnapshot } from "./helpers";

describe("Alpha Vantage – Analystenschätzungen (echter Auszug 13.10.2026)", () => {
  const est = parseEarningsEstimates(loadSnapshot("EARNINGS_ESTIMATES_AAPL_EXCERPT.json"));
  it("liest Geschäftsjahr- und Quartalsschätzungen mit Analystenzahl und Revisionen", () => {
    const fy27 = est.find((e) => e.periodEnd === "2027-09-30")!;
    expect(fy27).toMatchObject({ horizon: "FY", eps: 9.5804, epsHigh: 10.67, epsLow: 8.69, analysts: 40, revisionsUp30d: 5, revisionsDown30d: 3 });
    expect(fy27.revenue).toBe(528209118860);
  });
  it("FY1 = erstes noch nicht beendetes Geschäftsjahr; abgelaufenes, unberichtetes GJ ist nicht forward", () => {
    const f = forwardEstimates(est, "2026-10-13");
    expect(f.fy1!.periodEnd).toBe("2027-09-30");
    expect(f.fy2).toBeNull();
    expect(f.unreportedFy!.periodEnd).toBe("2026-09-30");
    expect(f.growthPct).toBeCloseTo((9.5804 / 8.8201 - 1) * 100, 8);
    expect(f.growthBasis).toContain("noch nicht berichtet");
    expect(f.revision30dPct).toBeCloseTo(((9.5804 - 9.5713) / 9.5713) * 100, 8);
  });
  it("vor Ende des GJ 2026 ist FY1 = 2026, FY2 = 2027", () => {
    const f = forwardEstimates(est, "2026-06-01");
    expect(f.fy1!.periodEnd).toBe("2026-09-30");
    expect(f.fy2!.periodEnd).toBe("2027-09-30");
    expect(f.growthBasis).toBe("FY2 ÷ FY1");
  });
});

describe("Alpha Vantage – Insidertransaktionen (echter Auszug)", () => {
  const tx = parseInsiderTransactions(loadSnapshot("INSIDER_TRANSACTIONS_AAPL_EXCERPT.json"));
  it("deutet das Feld als Form-4-Code: Verkauf, Schenkung, Ausübung, Steuereinbehalt, Zuteilung", () => {
    expect(tx.map((t) => t.code)).toEqual(["S", "G", "M", "F", "A", "S"]);
    expect(tx.map((t) => t.kind)).toEqual(["VERKAUF", "SONSTIGE", "SONSTIGE", "SONSTIGE", "ZUTEILUNG", "VERKAUF"]);
    expect(tx.some((t) => t.kind === "KAUF")).toBe(false); // keine Käufe am offenen Markt
  });
  it("Preis 0 bei Schenkung/Zuteilung wird nicht als Kurs übernommen; leerer Preis = null", () => {
    expect(tx[1]!.price).toBeNull();
    expect(tx[2]!.price).toBeNull();
    expect(tx[0]!.price).toBe(332.01);
  });
  it("identische Zeilen (Teilausführungen) bleiben getrennt", () => {
    const j = { data: [1, 2].map(() => ({ transaction_date: "2026-10-02", ticker: "AAPL", executive: "X", executive_title: "CEO", security_type: "Common Stock", acquisition_or_disposal: "S", shares: "10.0", share_price: "1.0" })) };
    const r = parseInsiderTransactions(j);
    expect(new Set(r.map((x) => x.dedupeKey)).size).toBe(2);
  });
});

describe("Alpha Vantage – institutionelle Beteiligungen (echter Auszug)", () => {
  const r = parseInstitutionalHoldings(loadSnapshot("INSTITUTIONAL_HOLDINGS_AAPL_EXCERPT.json"));
  it("Kopfdaten und Nettoveränderung", () => {
    expect(r).toMatchObject({ holders: 6423, increased: 2849, decreased: 3170, ownershipPct: 77, truncated: true });
    expect(r.netSharesChange).toBe(323385004 - 237716726);
  });
  it("erkennt unterschiedliche Meldestichtage (13F ist kein Echtzeitbestand)", () => {
    expect(r.reportPeriods).toEqual(["2025-12-31", "2026-06-30"]);
    expect(r.mixedPeriods).toBe(true);
  });
});

describe("Brent (echte Rohantwort)", () => {
  it("letzter Wert und Länge", () => {
    const m = parseEconomic(loadSnapshot("BRENT_DAILY.json"), "BRENT");
    expect(m.points.at(-1)).toEqual({ date: "2026-10-06", value: 125.44 });
  });
});
