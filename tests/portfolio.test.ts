import { describe, expect, it } from "vitest";
import { FxTable, decomposeReturn } from "@/lib/calc/fx";
import { computePortfolio, isOverOneYear, addYears, holdingsAt, modifiedDietz, type PInstrument, type PTx } from "@/lib/calc/portfolio";

describe("Währungsumrechnung", () => {
  const fx = new FxTable([{ pair: "EURUSD", rate: 1.12, date: "2026-10-09", source: "test" }]);
  it("direkt und invertiert mit Herkunftsangabe", () => {
    expect(fx.convert(100, "EUR", "USD")!.value).toBeCloseTo(112, 10);
    const c = fx.convert(112, "USD", "EUR")!;
    expect(c.value).toBeCloseTo(100, 10);
    expect(c.path).toContain("invertiert");
    expect(c.date).toBe("2026-10-09");
  });
  it("gleiche Währung = Faktor 1, fehlender Kurs = null (keine 1:1-Annahme)", () => {
    expect(fx.convert(5, "EUR", "EUR")!.value).toBe(5);
    expect(fx.convert(5, "CHF", "EUR")).toBeNull();
  });
  it("Kreuzkurs über EUR nutzt ältesten Datenstand", () => {
    const t = new FxTable([
      { pair: "EURUSD", rate: 1.1, date: "2026-10-09", source: "a" },
      { pair: "EURCHF", rate: 0.95, date: "2026-10-08", source: "b" },
    ]);
    const r = t.convert(1, "USD", "CHF")!;
    expect(r.value).toBeCloseTo(0.95 / 1.1, 10);
    expect(r.date).toBe("2026-10-08");
  });
  it("lehnt ungültige Kurse ab", () => {
    expect(() => new FxTable([{ pair: "EURUSD", rate: 0, date: "x", source: "x" }])).toThrow();
  });
  it("Zerlegung in Kurs- und Währungseffekt summiert sich zur Gesamtrendite", () => {
    // 10 Stück zu 100 USD gekauft bei 0,90 EUR/USD (Einstand 900 EUR); heute 120 USD bei 0,80 EUR/USD
    const d = decomposeReturn(10, 100, 900, 120, 0.8);
    expect(d.valueBase).toBeCloseTo(960, 10);
    expect(d.priceEffect).toBeCloseTo(160, 10);
    expect(d.fxEffect).toBeCloseTo(-100, 10);
    expect(d.priceEffect + d.fxEffect).toBeCloseTo(d.total, 10);
  });
});

const inst: PInstrument[] = [
  { id: "aapl", symbol: "AAPL", name: "Apple", assetType: "STOCK", currency: "USD", sector: "Technologie", maxWeightPct: 30 },
  { id: "btc", symbol: "BTC", name: "Bitcoin", assetType: "CRYPTO", currency: "EUR" },
  { id: "sap", symbol: "SAP", name: "SAP", assetType: "STOCK", currency: "EUR", sector: "Software" },
];

describe("Portfolio (FIFO, Basiswährung EUR)", () => {
  const fx = new FxTable([{ pair: "EURUSD", rate: 1.25, date: "2026-10-09", source: "test" }]); // 1 USD = 0,8 EUR
  const txs: PTx[] = [
    { id: "t1", instrumentId: "aapl", side: "BUY", tradeDate: "2025-01-10", quantity: 10, price: 100, priceCurrency: "USD", fees: 10, fxToBase: 0.9 },
    { id: "t2", instrumentId: "aapl", side: "BUY", tradeDate: "2025-06-10", quantity: 10, price: 150, priceCurrency: "USD", fees: 0, fxToBase: 0.85 },
    { id: "t3", instrumentId: "aapl", side: "SELL", tradeDate: "2026-02-01", quantity: 15, price: 200, priceCurrency: "USD", fees: 5, fxToBase: 0.8 },
    { id: "t4", instrumentId: "aapl", side: "DIVIDEND", tradeDate: "2026-05-01", quantity: 1, price: 20, priceCurrency: "USD", fees: 0, fxToBase: 0.8 },
    { id: "b1", instrumentId: "btc", side: "BUY", tradeDate: "2024-01-01", quantity: 1, price: 40000, priceCurrency: "EUR", fees: 0 },
    { id: "b2", instrumentId: "btc", side: "BUY", tradeDate: "2026-03-01", quantity: 1, price: 60000, priceCurrency: "EUR", fees: 0 },
    { id: "b3", instrumentId: "btc", side: "SELL", tradeDate: "2026-04-01", quantity: 1.5, price: 70000, priceCurrency: "EUR", fees: 0 },
  ];
  const prices = [
    { instrumentId: "aapl", price: 300, currency: "USD", asOf: "2026-10-09", source: "test" },
    { instrumentId: "btc", price: 74000, currency: "EUR", asOf: "2026-10-11", source: "test" },
  ];
  const r = computePortfolio(inst, txs, prices, fx, { baseCurrency: "EUR", today: "2026-10-11", cashBase: 1000 });
  const aapl = r.positions.find((p) => p.instrument.id === "aapl")!;
  const btc = r.positions.find((p) => p.instrument.id === "btc")!;

  it("FIFO-Restbestand und Einstand inkl. Gebühren", () => {
    expect(aapl.qty).toBeCloseTo(5, 10);
    expect(aapl.avgCostCcy).toBeCloseTo(150, 10); // nur zweites Lot übrig
    expect(aapl.costBase).toBeCloseTo(5 * 150 * 0.85, 10);
  });
  it("realisierter Gewinn in EUR zum jeweiligen historischen Kurs", () => {
    const sell = r.closedRealized.find((x) => x.txId === "t3")!;
    // Kosten: Lot1 10 Stk (1000 USD·0,9 + 10 USD·0,9 = 909 EUR) + 5 Stk aus Lot2 (5·150·0,85 = 637,5)
    expect(sell.costBase).toBeCloseTo(909 + 637.5, 8);
    expect(sell.proceedsBase).toBeCloseTo(15 * 200 * 0.8 - 5 * 0.8, 8);
    expect(sell.plBase).toBeCloseTo(15 * 200 * 0.8 - 4 - 1546.5, 8);
  });
  it("Marktwert, Kurs- und Währungseffekt in Basiswährung", () => {
    expect(aapl.valueBase).toBeCloseTo(5 * 300 * 0.8, 8);
    expect(aapl.priceEffectBase! + aapl.fxEffectBase!).toBeCloseTo(aapl.unrealizedBase!, 8);
    expect(aapl.fxNow!.path).toContain("invertiert");
  });
  it("Dividenden und Gebühren getrennt ausgewiesen", () => {
    expect(aapl.dividendsBase).toBeCloseTo(16, 10);
    expect(aapl.feesBase).toBeCloseTo(9 + 4, 10);
  });
  it("Krypto: Haltefrist je Lot (FIFO) wie im bisherigen Handelsbuch", () => {
    const sell = r.closedRealized.find((x) => x.txId === "b3")!;
    // 1 BTC aus 2024 (> 1 Jahr), 0,5 BTC aus März 2026 (< 1 Jahr)
    expect(sell.plOverOneYearBase).toBeCloseTo(70000 - 40000, 8);
    expect(sell.plUnderOneYearBase).toBeCloseTo(0.5 * 70000 - 0.5 * 60000, 8);
    expect(btc.qty).toBeCloseTo(0.5, 10);
    expect(btc.lots[0]!.holdingFreeFrom).toBe("2027-03-01");
  });
  it("Gewichte, Cashquote und Konzentration", () => {
    const total = 1200 + 37000 + 1000;
    expect(r.totalBase).toBeCloseTo(total, 6);
    expect(r.cashQuotaPct).toBeCloseTo((1000 / total) * 100, 6);
    expect(btc.weightPct).toBeCloseTo((37000 / total) * 100, 6);
    expect(r.concentration.largest).toBe("BTC");
    expect(r.warnings.join(" ")).not.toContain("AAPL: Gewicht");
  });
  it("fehlender historischer Wechselkurs → Einstand in EUR unbekannt + Warnung", () => {
    const r2 = computePortfolio(inst, [{ id: "x", instrumentId: "aapl", side: "BUY", tradeDate: "2026-01-01", quantity: 1, price: 100, priceCurrency: "USD", fees: 0 }], prices, fx, { baseCurrency: "EUR", today: "2026-10-11" });
    const p = r2.positions[0]!;
    expect(p.costBase).toBeNull();
    expect(p.unrealizedBase).toBeNull();
    expect(p.valueBase).toBeCloseTo(240, 8);
    expect(p.warnings.join(" ")).toContain("Historischer Wechselkurs");
  });
  it("fehlender Kurs → nicht bewertet, nicht in Summen", () => {
    const r3 = computePortfolio(inst, [{ id: "y", instrumentId: "sap", side: "BUY", tradeDate: "2026-01-01", quantity: 2, price: 200, priceCurrency: "EUR", fees: 0 }], [], fx, { baseCurrency: "EUR", today: "2026-10-11" });
    expect(r3.positions[0]!.valueBase).toBeNull();
    expect(r3.missingValue).toEqual(["SAP"]);
    expect(r3.investedValueBase).toBe(0);
  });
  it("Verkauf über Bestand wird gemeldet", () => {
    const r4 = computePortfolio(inst, [
      { id: "a", instrumentId: "sap", side: "BUY", tradeDate: "2026-01-01", quantity: 1, price: 100, priceCurrency: "EUR", fees: 0 },
      { id: "b", instrumentId: "sap", side: "SELL", tradeDate: "2026-02-01", quantity: 3, price: 100, priceCurrency: "EUR", fees: 0 },
    ], [], fx, { baseCurrency: "EUR", today: "2026-10-11" });
    expect(r4.closedRealized[0]!.unmatchedQty).toBeCloseTo(2, 10);
  });
});

describe("Haltefrist und Bestandsverlauf", () => {
  it("Jahresfrist inkl. Schaltjahr", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(isOverOneYear("2025-10-11", "2026-10-10")).toBe(false);
    expect(isOverOneYear("2025-10-11", "2026-10-11")).toBe(true);
  });
  it("Bestand zum Stichtag", () => {
    const txs: PTx[] = [
      { id: "1", instrumentId: "a", side: "BUY", tradeDate: "2026-01-01", quantity: 5, price: 1, priceCurrency: "EUR", fees: 0 },
      { id: "2", instrumentId: "a", side: "SELL", tradeDate: "2026-02-01", quantity: 2, price: 1, priceCurrency: "EUR", fees: 0 },
    ];
    expect(holdingsAt(txs, "2026-01-15").get("a")).toBe(5);
    expect(holdingsAt(txs, "2026-02-01").get("a")).toBe(3);
  });
  it("Modified Dietz berücksichtigt Zuflüsse", () => {
    const txs: PTx[] = [{ id: "1", instrumentId: "a", side: "BUY", tradeDate: "2026-01-16", quantity: 1, price: 100, priceCurrency: "EUR", fees: 0 }];
    // Start 1000, Zufluss 100 zur Hälfte der Periode, Ende 1210 → (1210-1000-100)/(1000+50) = 10,476 %
    const r = modifiedDietz(txs, "EUR", "2026-01-01", "2026-01-31", (d) => (d === "2026-01-01" ? 1000 : 1210))!;
    expect(r.returnPct).toBeCloseTo((110 / 1050) * 100, 6);
    expect(modifiedDietz(txs, "EUR", "2026-01-01", "2026-01-31", () => null)).toBeNull();
  });
});
