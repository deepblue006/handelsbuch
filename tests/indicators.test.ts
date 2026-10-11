import { describe, expect, it } from "vitest";
import {
  sma, ema, rsi, findCrosses, fibonacci, confluence, spreadPct, adr, weinsteinStage, toWeekly,
  detectPossibleSplits, pivots, zonesFromPivots, roundLevels, upDownVolume, isoWeekKey, annualizedVolatility, type Bar,
} from "@/lib/calc/indicators";
import { parseTimeSeries } from "@/lib/providers/alphavantage";
import { loadSnapshot } from "./helpers";

describe("SMA", () => {
  it("berechnet gleitende Durchschnitte und liefert null bei zu wenigen Werten", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("leere Reihe ergibt leeres Ergebnis", () => {
    expect(sma([], 200)).toEqual([]);
  });
  it("200er-SMA bei nur 100 Werten ist durchgehend null (keine Schätzung)", () => {
    const s = sma(Array.from({ length: 100 }, (_, i) => i + 1), 200);
    expect(s.every((x) => x === null)).toBe(true);
  });
  it("lehnt ungültige Perioden ab", () => {
    expect(() => sma([1, 2], 0)).toThrow();
  });
});

describe("EMA", () => {
  it("startet mit SMA und glättet mit α = 2/(n+1) (Handrechnung)", () => {
    expect(ema([1, 2, 3, 4, 5, 6], 3)).toEqual([null, null, 2, 3, 4, 5]);
  });
  it("EMA 10/20 auf echten SPY-Wochenkursen entspricht unabhängiger Python-Referenz", () => {
    const s = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD");
    const c = s.bars.map((b) => b.close);
    expect(ema(c, 10).at(-1)).toBeCloseTo(766.4394489426261, 6);
    expect(ema(c, 20).at(-1)).toBeCloseTo(754.1950079424689, 6);
  });
});

describe("RSI (Wilder)", () => {
  it("Handrechnung RSI(2)", () => {
    const r = rsi([1, 2, 3, 2, 3, 4], 2);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBe(100);
    expect(r[3]).toBeCloseTo(50, 10);
    expect(r[4]).toBeCloseTo(75, 10);
    expect(r[5]).toBeCloseTo(87.5, 10);
  });
  it("Lehrbuchbeispiel RSI 14 (StockCharts/Wilder-Datensatz)", () => {
    const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672, 43.4205, 42.6628, 43.1314];
    const r = rsi(closes, 14);
    const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];
    expected.forEach((e, i) => expect(r[14 + i]!).toBeCloseTo(e, 1));
  });
  it("RSI 5 reagiert stärker als RSI 14", () => {
    const up = [10, 10.5, 10.2, 10.8, 11, 11.4, 11.1, 11.9, 12.4, 12.1, 12.9, 13.5, 13.2, 14, 14.6, 13.9, 13.1, 12.5];
    const r5 = rsi(up, 5).at(-1)!;
    const r14 = rsi(up, 14).at(-1)!;
    expect(r5).toBeLessThan(r14); // nach drei Verlusttagen fällt RSI 5 schneller
  });
  it("konstante Reihe → 50, nur Gewinne → 100", () => {
    expect(rsi([5, 5, 5, 5], 2).at(-1)).toBe(50);
    expect(rsi([1, 2, 3, 4], 2).at(-1)).toBe(100);
  });
  it("RSI 14 auf echten SPY-Wochenkursen entspricht Python-Referenz", () => {
    const s = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD");
    expect(rsi(s.bars.map((b) => b.close), 14).at(-1)).toBeCloseTo(65.07036488333395, 6);
  });
  it("zu kurze Reihe → nur null", () => {
    expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
  });
});

describe("Golden/Death Cross", () => {
  it("erkennt Kreuzungen nur, wenn beide Linien existieren", () => {
    const dates = ["d1", "d2", "d3", "d4", "d5"];
    const fast = [null, 1, 3, 3, 1];
    const slow = [null, 2, 2, 2, 2];
    expect(findCrosses(dates, fast, slow)).toEqual([
      { index: 2, date: "d3", type: "GOLDEN_CROSS" },
      { index: 4, date: "d5", type: "DEATH_CROSS" },
    ]);
  });
});

const mkBars = (closes: number[], start = "2026-01-01"): Bar[] =>
  closes.map((c, i) => {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), close: c, high: c * 1.01, low: c * 0.99, volume: 1000 + i };
  });

describe("Fibonacci", () => {
  it("Aufwärtsbewegung: Level = Hoch − Spanne × Ratio, Golden Pocket 0,618–0,65", () => {
    const bars: Bar[] = [
      { date: "2026-01-01", close: 100, high: 100, low: 100 },
      { date: "2026-01-02", close: 150, high: 150, low: 120 },
      { date: "2026-01-03", close: 200, high: 200, low: 180 },
    ];
    const f = fibonacci(bars, 10)!;
    expect(f.direction).toBe("AUFWÄRTS");
    const lv = Object.fromEntries(f.levels.map((l) => [l.ratio, l.price]));
    expect(lv[0.382]).toBeCloseTo(161.8, 6);
    expect(lv[0.5]).toBeCloseTo(150, 6);
    expect(lv[0.618]).toBeCloseTo(138.2, 6);
    expect(f.goldenPocket.from).toBeCloseTo(135, 6);
    expect(f.goldenPocket.to).toBeCloseTo(138.2, 6);
  });
  it("Abwärtsbewegung: Level = Tief + Spanne × Ratio", () => {
    const bars: Bar[] = [
      { date: "2026-01-01", close: 200, high: 200, low: 200 },
      { date: "2026-01-02", close: 100, high: 110, low: 100 },
    ];
    const f = fibonacci(bars, 10)!;
    expect(f.direction).toBe("ABWÄRTS");
    expect(f.levels.find((l) => l.ratio === 0.5)!.price).toBeCloseTo(150, 6);
  });
  it("verwendet keine Daten nach dem Entscheidungszeitpunkt (kein Look-ahead)", () => {
    const bars = mkBars([100, 110, 120, 130, 500]);
    const f = fibonacci(bars, 10, 3)!;
    expect(f.swingHigh.price).toBeCloseTo(130 * 1.01, 6);
  });
  it("Konfluenz mit 200-Tage-Linie", () => {
    expect(confluence([{ ratio: 0.618, price: 138.2 }, { ratio: 0.5, price: 150 }], 139, 1.5)).toHaveLength(1);
    expect(confluence([{ ratio: 0.5, price: 150 }], null)).toEqual([]);
  });
});

describe("Spread", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  it("Spread in % = (Brief − Geld) ÷ Geld × 100", () => {
    const s = spreadPct(100, 100.5, new Date("2026-10-09T14:59:00Z"), now)!;
    expect(s.spreadPct).toBeCloseTo(0.5, 10);
    expect(s.stale).toBe(false);
  });
  it("markiert veraltete Geld-/Briefkurse", () => {
    expect(spreadPct(100, 101, new Date("2026-10-08T15:00:00Z"), now)!.stale).toBe(true);
  });
  it("ungültige Kurse → null", () => {
    expect(spreadPct(0, 1, now, now)).toBeNull();
    expect(spreadPct(101, 100, now, now)).toBeNull();
  });
});

describe("ADR und Volumen", () => {
  it("ADR absolut und prozentual", () => {
    const bars: Bar[] = [
      { date: "a", close: 10, high: 11, low: 10 },
      { date: "b", close: 10, high: 12, low: 10 },
    ];
    const r = adr(bars, 2)!;
    expect(r.abs).toBeCloseTo(1.5, 10);
    expect(r.pct).toBeCloseTo(((1.1 + 1.2) / 2 - 1) * 100, 10);
    expect(adr(bars, 5)).toBeNull();
  });
  it("Volumen an Auf- und Abwärtstagen", () => {
    const bars: Bar[] = [
      { date: "a", close: 10, volume: 100 },
      { date: "b", close: 11, volume: 300 },
      { date: "c", close: 10, volume: 100 },
    ];
    const v = upDownVolume(bars, 5)!;
    expect(v.avgUpVolume).toBe(300);
    expect(v.avgDownVolume).toBe(100);
    expect(v.ratio).toBe(3);
  });
});

describe("Stage-Analyse", () => {
  it("steigende Linie, Kurs darüber → Stage 2", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    expect(weinsteinStage(closes).stage).toBe(2);
  });
  it("fallende Linie, Kurs darunter → Stage 4", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 300 - i * 2);
    expect(weinsteinStage(closes).stage).toBe(4);
  });
  it("Seitwärts nach Abwärtstrend → Stage 1", () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 300 - i * 4), ...Array.from({ length: 40 }, (_, i) => 140 + (i % 2))];
    expect(weinsteinStage(closes).stage).toBe(1);
  });
  it("zu wenige Wochen → keine Stage", () => {
    expect(weinsteinStage([1, 2, 3]).stage).toBeNull();
  });
  it("Rückeroberung der 30-Wochen-Linie wird erkannt", () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 200 - i), 150, 150, 150, 175];
    const r = weinsteinStage(closes);
    expect(r.reclaimed).toBe(true);
  });
  it("SPY-Wochenkurse: 30-Wochen-Linie entspricht Python-Referenz", () => {
    const s = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD");
    const r = weinsteinStage(s.bars.map((b) => b.close));
    expect(r.ma30w).toBeCloseTo(737.5333333333333, 6);
    expect(r.slopePct).toBeCloseTo(((737.5333333333333 - 725.1613333333333) / 725.1613333333333) * 100, 6);
    expect(r.stage).toBe(2);
  });
});

describe("Wochenaggregation", () => {
  it("ISO-Woche und Zusammenfassung zu Wochenkerzen", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    const bars = mkBars([1, 2, 3, 4, 5, 6, 7, 8], "2026-10-05"); // Mo 05.10. bis Mo 12.10.
    const w = toWeekly(bars, "2026-10-12");
    expect(w).toHaveLength(2);
    expect(w[0]!.close).toBe(7);
    expect(w[0]!.date).toBe("2026-10-11");
    expect(w[1]!.complete).toBe(false);
  });
});

describe("Unterstützung/Widerstand, runde Marken, Splits, Volatilität", () => {
  it("Pivots sind erst k Kerzen später bestätigt", () => {
    const bars = mkBars([1, 2, 3, 10, 3, 2, 1]);
    const p = pivots(bars, 3);
    expect(p).toHaveLength(1);
    expect(p[0]!.kind).toBe("HOCH");
    expect(p[0]!.confirmedAt).toBe(bars[6]!.date);
  });
  it("bündelt nahe Pivots zu Zonen", () => {
    const z = zonesFromPivots([
      { index: 1, date: "a", price: 100, kind: "TIEF", confirmedAt: "a" },
      { index: 2, date: "b", price: 100.8, kind: "TIEF", confirmedAt: "b" },
      { index: 3, date: "c", price: 150, kind: "HOCH", confirmedAt: "c" },
    ], 120);
    expect(z).toHaveLength(1);
    expect(z[0]!.kind).toBe("UNTERSTÜTZUNG");
    expect(z[0]!.touches).toBe(2);
  });
  it("runde Marken", () => {
    expect(roundLevels(336.64)).toEqual([250, 300, 350, 400]); // Schrittweite 50 unter 500
    expect(roundLevels(74028)).toEqual([60000, 70000, 80000, 90000]);
    expect(roundLevels(0)).toEqual([]);
  });
  it("erkennt mögliche unbereinigte Splits in echten AAPL-Rohwochenkursen (7:1 2014, 4:1 2020)", () => {
    const s = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_AAPL.json"), "WEEK", "USD");
    const splits = detectPossibleSplits(s.bars);
    expect(splits).toContainEqual({ date: "2014-06-13", factor: 7 });
    expect(splits).toContainEqual({ date: "2020-09-04", factor: 4 });
  });
  it("Volatilität: konstante Reihe = 0, zu kurz = null", () => {
    expect(annualizedVolatility([1, 1, 1, 1])).toBe(0);
    expect(annualizedVolatility([1])).toBeNull();
  });
});
