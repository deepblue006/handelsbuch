import { describe, expect, it } from "vitest";
import { sectorRotation, seasonality } from "@/lib/calc/sectors";
import { parseTimeSeries } from "@/lib/providers/alphavantage";
import { loadSnapshot } from "./helpers";

const weekly = (s: string) => parseTimeSeries(loadSnapshot(`TIME_SERIES_WEEKLY_${s}.json`), "WEEK", "USD", "2026-10-13");
const complete = (s: string) => { const r = weekly(s); return r.partialLastBar ? r.bars.slice(0, -1) : r.bars; };

describe("Sektorrotation (echte Wochenkurse)", () => {
  const spy = weekly("SPY").bars;
  it("laufende Woche wird als unvollständig erkannt (Abruf am Dienstag)", () => {
    expect(weekly("XLK").partialLastBar).toBe(true);
    expect(complete("XLK").at(-1)!.date).toBe("2026-10-09");
  });
  it("relative Stärke = Sektorrendite − Benchmarkrendite, unabhängig nachgerechnet", () => {
    const xlf = complete("XLF");
    const r = sectorRotation([{ symbol: "XLF", label: "Finanzen", bars: xlf }], spy);
    const i = xlf.findIndex((b) => b.date === "2026-10-09");
    const own = ((xlf[i]!.close - xlf[i - 13]!.close) / xlf[i - 13]!.close) * 100;
    const j = spy.findIndex((b) => b.date === "2026-10-09");
    const bm = ((spy[j]!.close - spy[j - 13]!.close) / spy[j - 13]!.close) * 100;
    expect(r.rows[0]!.returns[13]).toBeCloseTo(own, 10);
    expect(r.rows[0]!.relative[13]).toBeCloseTo(own - bm, 10);
  });
  it("Fenster mit möglichem Split werden ausgelassen statt verfälscht", () => {
    const syn = [100, 101, 102, 103, 51, 52].map((c, k) => ({ date: `2026-01-0${k + 1}`, close: c }));
    const bm = syn.map((b) => ({ ...b, close: 100 }));
    const r = sectorRotation([{ symbol: "X", label: "X", bars: syn }], bm, [4]);
    expect(r.rows[0]!.returns[4]).toBeNull();
    expect(r.rows[0]!.splitInWindow[4]).toBe(true);
  });
});

describe("Saisonalität (SPY, echte Wochenkurse)", () => {
  it("nur vollständige Monate, ausreichende Jahre, Werte plausibel", () => {
    const s = seasonality(weekly("SPY").bars, "2026-10-13");
    expect(s.to).toBe("2026-09");
    expect(s.sufficient).toBe(true);
    expect(s.years).toBeGreaterThanOrEqual(20);
    for (const m of s.stats) { expect(m.positivePct!).toBeGreaterThan(20); expect(m.positivePct!).toBeLessThan(90); }
  });
  it("zu kurze Historie wird als unzureichend gekennzeichnet", () => {
    const s = seasonality(weekly("SPY").bars.slice(-60), "2026-10-13");
    expect(s.sufficient).toBe(false);
  });
});
