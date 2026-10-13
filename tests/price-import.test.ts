import { describe, expect, it } from "vitest";
import { parsePriceCsv } from "@/lib/portfolio/price-import";

describe("Kurs-CSV-Import", () => {
  it("englisches Format mit Adj Close; Sortierung aufsteigend", () => {
    const csv = "Date,Open,High,Low,Close,Adj Close,Volume\n2026-10-09,331.69,338.61,330.70,336.64,336.10,37881199\n2026-10-08,336.81,341.57,335.90,340.42,339.90,35332449";
    const r = parsePriceCsv(csv);
    expect(r.bars.map((b) => b.date)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(r.bars[1]).toMatchObject({ close: 336.64, high: 338.61, volume: 37881199 });
    const adj = parsePriceCsv(csv, { useAdjusted: true });
    expect(adj.usedAdjusted).toBe(true);
    expect(adj.bars[1]).toMatchObject({ close: 336.1, high: null, low: null });
  });
  it("deutsches Format mit Semikolon und Dezimalkomma", () => {
    const r = parsePriceCsv("Datum;Eröffnung;Hoch;Tief;Schlusskurs;Volumen\n09.10.2026;331,69;338,61;330,70;336,64;37.881.199");
    expect(r.bars[0]).toMatchObject({ date: "2026-10-09", close: 336.64, volume: 37881199 });
  });
  it("ungültige Zeilen, Zukunft und Dubletten werden gemeldet", () => {
    const r = parsePriceCsv("Date,High,Low,Close\n2026-10-09,1,2,1.5\n2026-10-08,2,1,-1\nfoo,2,1,1\n2030-01-01,2,1,1\n2026-10-07,2,1,1\n2026-10-07,2,1,1.1", { today: "2026-10-13" });
    expect(r.invalid.map((i) => i.reason)).toEqual(["Hoch < Tief", "Schlusskurs fehlt oder ≤ 0", "Datum ungültig", "Datum in der Zukunft"]);
    expect(r.duplicates).toBe(1);
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.close).toBe(1.1);
  });
  it("fehlende Pflichtspalten → klare Fehlermeldung", () => {
    expect(() => parsePriceCsv("a,b\n1,2")).toThrow(/Datum und Schlusskurs/);
  });
});
