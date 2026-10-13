import { describe, expect, it } from "vitest";
import { eventBacktest, below } from "@/lib/calc/backtest";
import { rsi, type Bar } from "@/lib/calc/indicators";
import { parseTimeSeries } from "@/lib/providers/alphavantage";
import { loadSnapshot } from "./helpers";

const mk = (c: number[]): Bar[] => c.map((close, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, close }));

describe("Ereignis-Backtest", () => {
  it("Einstieg erst an der Folgekerze (kein Look-ahead), Gebühren abgezogen", () => {
    const bars = mk([100, 50, 60, 66, 70]);
    const r = eventBacktest(bars, (i) => i === 1, { holdBars: 2, feePct: 1, minSamples: 1, adjusted: true });
    expect(r.signals).toEqual([{ date: "2026-01-02", entry: 60, exit: 70, returnPct: (10 / 60) * 100 - 1 }]);
  });
  it("Sperrfrist verhindert überlappende Signale", () => {
    const r = eventBacktest(mk([1, 2, 3, 4, 5, 6, 7, 8]), () => true, { holdBars: 2, minSamples: 1, adjusted: true });
    expect(r.signals.map((s) => s.date)).toEqual(["2026-01-01", "2026-01-04"]);
  });
  it("zu kleine Stichprobe → ausdrücklich nicht ausreichend", () => {
    const r = eventBacktest(mk([1, 2, 3, 4, 5, 6]), (i) => i === 0, { holdBars: 1, adjusted: true });
    expect(r.status).toBe("NICHT_AUSREICHEND");
    expect(r.reason).toContain("kein belastbarer Backtest");
  });
  it("unbereinigte Rohkurse mit Split (AAPL) werden abgelehnt", () => {
    const b = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_AAPL.json"), "WEEK", "USD").bars;
    expect(eventBacktest(b, () => true, { holdBars: 4, adjusted: false }).status).toBe("UNGEEIGNET");
  });
  it("SPY-Wochen (keine Splits): RSI-14-Signal mit Stichprobengröße und Basisrate", () => {
    const b = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD").bars;
    const r = eventBacktest(b, below(rsi(b.map((x) => x.close), 14), 30), { holdBars: 13, adjusted: false, minSamples: 5 });
    expect(["OK", "NICHT_AUSREICHEND"]).toContain(r.status);
    expect(r.sampleSize).toBe(r.signals.length);
    expect(r.baselineAvgPct).not.toBeNull();
  });
});
