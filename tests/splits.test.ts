import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { adjustForSplits, mergeSplits, parseSplitRatio, formatSplitRatio } from "@/lib/calc/splits";
import { parseTimeSeries, parseSplits } from "@/lib/providers/alphavantage";
import { detectPossibleSplits, type Bar } from "@/lib/calc/indicators";

const bar = (date: string, close: number, extra: Partial<Bar> = {}): Bar => ({ date, open: close, high: close, low: close, close, volume: 100, ...extra });

describe("Split-Bereinigung", () => {
  it("teilt Kurse vor dem Wirksamkeitsdatum durch den Faktor und multipliziert das Volumen", () => {
    const bars = [bar("2024-06-03", 400), bar("2024-06-04", 404), bar("2024-06-05", 101), bar("2024-06-06", 102)];
    const r = adjustForSplits(bars, [{ date: "2024-06-05", factor: 4, source: "test" }], "DAY");
    expect(r.bars.map((b) => b.close)).toEqual([100, 101, 101, 102]);
    expect(r.bars[0]!.volume).toBe(400);
    expect(r.bars[2]!.volume).toBe(100);
    expect(r.residualJumps).toEqual([]);
    expect(r.applied).toHaveLength(1);
  });

  it("verkettet mehrere Splits und behandelt Zusammenlegungen (Faktor < 1)", () => {
    const bars = [bar("2020-01-03", 80), bar("2020-01-10", 40), bar("2020-01-17", 400)];
    const r = adjustForSplits(bars, [{ date: "2020-01-06", factor: 2, source: "a" }, { date: "2020-01-13", factor: 0.1, source: "a" }], "WEEK");
    expect(r.bars.map((b) => b.close)).toEqual([400, 400, 400]);
  });

  it("markiert Wochenkerzen mit Split innerhalb der Woche als Näherung", () => {
    // Split am Mittwoch: Open der Woche noch vor dem Split
    const bars = [bar("2025-11-28", 200), bar("2025-12-05", 101, { open: 201, high: 204, low: 99 })];
    const r = adjustForSplits(bars, [{ date: "2025-12-03", factor: 2, source: "x" }], "WEEK");
    expect(r.approximateBars).toEqual(["2025-12-05"]);
    expect(r.bars[1]!.open).toBeCloseTo(100.5);
    expect(r.bars[1]!.high).toBeCloseTo(102);
    // Split am Montag: ganze Woche nach dem Split, keine Näherung
    const r2 = adjustForSplits(bars, [{ date: "2025-12-01", factor: 2, source: "x" }], "WEEK");
    expect(r2.approximateBars).toEqual([]);
  });

  it("meldet Sprünge, die zeitlich zu einem gemeldeten Split passen, aber nicht bereinigt wurden (Datum falsch)", () => {
    const bars = [bar("2024-06-03", 400), bar("2024-06-04", 404), bar("2024-06-05", 101)];
    const r = adjustForSplits(bars, [{ date: "2024-06-04", factor: 4, source: "falsch" }], "DAY");
    expect(r.mismatches.length).toBeGreaterThan(0);
  });

  it("ignoriert Splits außerhalb der Kursreihe und dedupliziert widersprüchliche Angaben", () => {
    const r = adjustForSplits([bar("2024-01-02", 10), bar("2024-01-03", 10)], [{ date: "2023-01-01", factor: 2, source: "a" }], "DAY");
    expect(r.applied).toEqual([]);
    const m = mergeSplits([{ date: "2024-01-03", factor: 2, source: "manuell" }, { date: "2024-01-03", factor: 3, source: "alphavantage" }, { date: "2024-01-04", factor: 1, source: "x" }]);
    expect(m.splits).toHaveLength(1);
    expect(m.splits[0]!.source).toBe("manuell");
    expect(m.conflicts).toHaveLength(1);
  });

  it("echte AAPL-Wochenkurse: die bekannten Splits 2005/2014/2020 beseitigen die Sprünge, der Kurssturz 29.09.2000 bleibt ein echter Kurssprung", () => {
    const json = JSON.parse(readFileSync("data/snapshots/alphavantage/TIME_SERIES_WEEKLY_AAPL.json", "utf8"));
    const s = parseTimeSeries(json, "WEEK", "USD");
    // Öffentlich dokumentierte Apple-Splits (Investor Relations): 2:1 2000-06-21, 2:1 2005-02-28, 7:1 2014-06-09, 4:1 2020-08-31
    const splits = [
      { date: "2000-06-21", factor: 2, source: "Apple IR" }, { date: "2005-02-28", factor: 2, source: "Apple IR" },
      { date: "2014-06-09", factor: 7, source: "Apple IR" }, { date: "2020-08-31", factor: 4, source: "Apple IR" },
    ];
    const r = adjustForSplits(s.bars, splits, "WEEK");
    expect(r.residualJumps.map((j) => j.date)).toEqual(["2000-09-29"]);
    expect(r.mismatches).toEqual([]);
  });
});

describe("Split-Erkennung auf Wochenkursen (echte Daten)", () => {
  it("XLU 12/2025: Sprung um Faktor 2,09 wird bei Wochenkursen als möglicher Split erkannt (vorher als −54 % Rendite durchgerutscht)", () => {
    const s = parseTimeSeries(JSON.parse(readFileSync("data/snapshots/alphavantage/TIME_SERIES_WEEKLY_XLU.json", "utf8")), "WEEK", "USD");
    expect(detectPossibleSplits(s.bars.slice(-60)).map((x) => x.date)).toContain("2025-12-05");
    // explizite Tageskurs-Toleranz (4 %) würde ihn verfehlen
    expect(detectPossibleSplits(s.bars.slice(-60), 4).map((x) => x.date)).not.toContain("2025-12-05");
  });
  it("normale Wochenbewegungen lösen keinen Split-Verdacht aus (SPY, 27 Jahre)", () => {
    const s = parseTimeSeries(JSON.parse(readFileSync("data/snapshots/alphavantage/TIME_SERIES_WEEKLY_SPY.json", "utf8")), "WEEK", "USD");
    expect(detectPossibleSplits(s.bars)).toEqual([]);
  });
});

describe("Split-Verhältnis", () => {
  it("liest neu:alt und Dezimalfaktoren, lehnt 1:1 und Unsinn ab", () => {
    expect(parseSplitRatio("4:1")).toBe(4);
    expect(parseSplitRatio("1:10")).toBeCloseTo(0.1);
    expect(parseSplitRatio("3/2")).toBe(1.5);
    expect(parseSplitRatio("2,5")).toBe(2.5);
    expect(parseSplitRatio("1:1")).toBeNull();
    expect(parseSplitRatio("abc")).toBeNull();
    expect(parseSplitRatio("0")).toBeNull();
    expect(formatSplitRatio(4)).toBe("4:1");
    expect(formatSplitRatio(0.1)).toBe("1:10");
    expect(formatSplitRatio(1.5)).toBe("1.5:1");
  });
});

describe("Alpha Vantage SPLITS", () => {
  it("liest das dokumentierte JSON-Format und lehnt unplausible Faktoren ab", () => {
    const r = parseSplits({ symbol: "IBM", data: [{ effective_date: "1999-05-27", split_factor: "2.0000" }, { effective_date: "1997-05-28", split_factor: "2.0000" }, { effective_date: "x", split_factor: "2" }, { effective_date: "2001-01-01", split_factor: "0" }] });
    expect(r.splits).toEqual([{ date: "1997-05-28", factor: 2 }, { date: "1999-05-27", factor: 2 }]);
    expect(r.invalid).toBe(2);
  });
  it("leere Liste ist ein gültiges Ergebnis (keine Splits)", () => {
    expect(parseSplits({ symbol: "SPY", data: [] }).splits).toEqual([]);
  });
  it("unbekanntes Format führt zu einem Formatfehler statt zu einer stillen leeren Liste", () => {
    expect(() => parseSplits({ foo: 1 })).toThrow();
  });
});
