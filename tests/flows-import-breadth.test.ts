import { describe, expect, it } from "vitest";
import { parseFlowNumber, parseFlowDate, parseWideFlowTable, dedupeFlows, aggregateFlows, findGaps, correlation, type FlowRow } from "@/lib/flows/flows";
import { parseDecimal, parseDateFlexible, previewTransactionsCsv, parseLegacyBackup, CSV_TEMPLATE_HEADER } from "@/lib/portfolio/import";
import { breadthAt, drawdownFromHigh } from "@/lib/calc/breadth";
import { parseTimeSeries } from "@/lib/providers/alphavantage";
import { loadSnapshot } from "./helpers";

describe("ETF-Flows", () => {
  it("Zahlenformat im Farside-Stil: Klammern negativ, '-' = kein Wert (nicht 0)", () => {
    expect(parseFlowNumber("(12.3)")).toBe(-12.3);
    expect(parseFlowNumber("1,234.5")).toBe(1234.5);
    expect(parseFlowNumber("-")).toBeNull();
    expect(parseFlowNumber("0.0")).toBe(0);
  });
  it("Datumsformate", () => {
    expect(parseFlowDate("11 Jan 2024")).toBe("2024-01-11");
    expect(parseFlowDate("09.10.2026")).toBe("2026-10-09");
    expect(parseFlowDate("Total")).toBeNull();
  });
  it("breite Tabelle: Total-Spalte und Summenzeilen werden nicht importiert", () => {
    const t = "Date\tIBIT\tFBTC\tTotal\n08 Oct 2026\t100.5\t(20.0)\t80.5\n09 Oct 2026\t-\t15.0\t15.0\nTotal\t100.5\t(5.0)\t95.5";
    const r = parseWideFlowTable(t, { assetClass: "BTC", provider: "farside" });
    expect(r.tickers).toEqual(["IBIT", "FBTC"]);
    expect(r.rows).toHaveLength(3); // IBIT 09.10. fehlt („-“)
    expect(r.skipped).toEqual([{ line: 4, reason: "kein Datum („Total“)" }]);
    expect(r.rows.every((x) => x.aum === null)).toBe(true);
  });
  const row = (p: string, v: number | null, t = "IBIT", d = "2026-10-08"): FlowRow => ({ fundTicker: t, issuer: null, assetClass: "BTC", date: d, netFlow: v, flowUnit: "USD_MILLION", aum: null, volume: null, closePrice: null, status: "UNBESTÄTIGT", provider: p });
  it("keine Doppelzählung bei mehreren Quellen; Abweichung wird ausgewiesen", () => {
    const d = dedupeFlows([row("sosovalue", 101), row("farside", 100), row("farside", 5, "FBTC")], ["farside", "sosovalue"]);
    expect(d).toHaveLength(2);
    const ibit = d.find((x) => x.fundTicker === "IBIT")!;
    expect(ibit.provider).toBe("farside");
    expect(ibit.maxDeviation).toBe(1);
    expect(ibit.alternatives).toEqual([{ provider: "sosovalue", netFlow: 101 }]);
  });
  it("Tages- und kumulierte Flüsse je Anlageklasse", () => {
    const a = aggregateFlows([row("f", 10, "IBIT", "2026-10-07"), row("f", -4, "FBTC", "2026-10-07"), row("f", 3, "IBIT", "2026-10-08"), row("f", null, "IBIT", "2026-10-09")], "assetClass");
    expect(a.series).toEqual([{ date: "2026-10-07", BTC: 6, BTC_kum: 6 }, { date: "2026-10-08", BTC: 3, BTC_kum: 9 }]);
    expect(a.coverage.days).toBe(2);
  });
  it("Lücken an Werktagen, Korrelation rein beschreibend", () => {
    expect(findGaps(["2026-10-05", "2026-10-09"])).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(findGaps(["2026-10-09", "2026-10-12"])).toEqual([]);
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("CSV-Import mit Vorschau", () => {
  it("Zahlen und Daten in deutscher und englischer Schreibweise", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal("1.000.000")).toBe(1000000);
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDateFlexible("31.02.2026")).toBeNull();
    expect(parseDateFlexible("09.10.2026")).toBe("2026-10-09");
  });
  it("gültige und ungültige Zeilen mit Begründung", () => {
    const csv = [
      CSV_TEMPLATE_HEADER,
      "09.10.2026;Kauf;AAPL;Apple;Aktie;NASDAQ;USD;10;336,64;1;EUR;0,8928;Nachkauf",
      "2026-10-01;Verkauf;SAP;SAP SE;Aktie;XETRA;EUR;2;210,5;;;;",
      "2030-01-01;Kauf;X;X;Aktie;;EUR;1;1;;;;",
      "01.10.2026;Tausch;Y;Y;Aktie;;EUR;-1;1;;;;",
      "01.10.2026;Kauf;BTC;Bitcoin;Krypto;;EUR;0,1;70000;;;;abandon ability able about above absent absorb abstract absurd abuse access accident",
      "01.10.2026;Kauf;MSFT;Microsoft;Aktie;NASDAQ;USD;1;500;;;;",
    ].join("\n");
    const p = previewTransactionsCsv(csv, "EUR", "2026-10-11");
    expect(p.valid.map((v) => v.row.symbol)).toEqual(["AAPL", "SAP", "MSFT"]);
    expect(p.valid[0]!.row).toMatchObject({ side: "BUY", quantity: 10, price: 336.64, fees: 1, feeCurrency: "EUR", fxToBase: 0.8928 });
    expect(p.valid[2]!.warnings.join(" ")).toContain("Kein Wechselkurs");
    expect(p.invalid.map((i) => i.line)).toEqual([4, 5, 6]);
    expect(p.invalid[0]!.errors.join(" ")).toContain("Zukunft");
    expect(p.invalid[1]!.errors.join(" ")).toMatch(/Typ unbekannt/);
    expect(p.invalid[2]!.errors.join(" ")).toContain("Seed-Phrase");
    expect(JSON.stringify(p.invalid[2]!.raw)).not.toContain("abandon");
  });
});

describe("Übernahme des bisherigen Handelsbuchs", () => {
  it("liest Format version 1 und übernimmt Buchungen in EUR", () => {
    const backup = { version: 1, exported: "2026-10-01T00:00:00Z", assets: [{ id: "a1", symbol: "btc", name: "Bitcoin", type: "crypto", price: 70000 }, { id: "a2", symbol: "SAP", name: "", type: "stock", price: null }], trades: [{ id: "t1", assetId: "a1", side: "buy", date: "2025-01-02", qty: 0.1, price: 90000, fee: 5, note: "erster Kauf", seq: 1 }, { id: "t2", assetId: "zz", side: "buy", date: "2025-01-02", qty: 1, price: 1, fee: 0, note: "" }], plans: [{ id: "p1", symbol: "nvda", type: "stock", entry: 120, qtyPlan: 5, price: 130, note: "warten" }] };
    const r = parseLegacyBackup(backup);
    expect(r.instruments.map((i) => [i.symbol, i.assetType])).toEqual([["BTC", "CRYPTO"], ["SAP", "STOCK"]]);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ side: "BUY", quantity: 0.1, price: 90000, fees: 5 });
    expect(r.warnings[0]).toContain("t2");
    expect(r.plans[0]).toMatchObject({ symbol: "NVDA", entry: 120, qty: 5 });
  });
  it("lehnt fremde Dateien ab", () => {
    expect(() => parseLegacyBackup({ foo: 1 })).toThrow(/Sicherung/);
  });
});

describe("Marktbreite", () => {
  const series = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000); return { date: d.toISOString().slice(0, 10), close: f(i) }; });
  it("zählt nur auswertbare Titel und dokumentiert Ausschlüsse", () => {
    const up = series(220, (i) => 100 + i);
    const down = series(220, (i) => 400 - i);
    const short = series(50, () => 10);
    const asOf = up.at(-1)!.date;
    const r = breadthAt([{ symbol: "UP", bars: up }, { symbol: "DOWN", bars: down }, { symbol: "NEU", bars: short }], asOf);
    expect(r.evaluated).toBe(2);
    expect(r.universeSize).toBe(3);
    expect(r.pctAbove).toBe(50);
    expect(r.members.find((m) => m.symbol === "NEU")!.reason).toContain("50 von 200");
  });
  it("kein Look-ahead: Stichtag in der Vergangenheit nutzt nur Kurse bis dahin", () => {
    const s = series(400, (i) => (i < 300 ? 100 + i : 50));
    const early = breadthAt([{ symbol: "A", bars: s }], s[250]!.date);
    expect(early.members[0]!.status).toBe("ÜBER");
    expect(breadthAt([{ symbol: "A", bars: s }], s[399]!.date).members[0]!.status).toBe("UNTER");
  });
  it("Abstand zum Hoch auf echten SPY-Wochenkursen", () => {
    const b = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD").bars;
    const dd = drawdownFromHigh(b.map((x) => ({ date: x.date, close: x.close })))!;
    expect(dd.last).toBe(778.57);
    expect(dd.drawdownPct).toBeLessThanOrEqual(0);
    expect(drawdownFromHigh([])).toBeNull();
  });
});
