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

  it("Nasdaq.com-Format (synthetisch, laut Erinnerung – nicht live geprüft): Close/Last, $-Werte, US-Datum MM/TT/JJJJ", () => {
    const csv = "Date,Close/Last,Volume,Open,High,Low\n10/09/2026,$336.64,41234567,$330.10,$338.00,$329.50\n10/08/2026,$331.20,39000000,$328.00,$332.00,$327.10\n09/30/2026,$320.00,38000000,$319.00,$321.00,$318.00\n";
    const r = parsePriceCsv(csv);
    expect(r.invalid).toEqual([]);
    expect(r.bars.map((b) => b.date)).toEqual(["2026-09-30", "2026-10-08", "2026-10-09"]);
    expect(r.bars.at(-1)).toMatchObject({ close: 336.64, open: 330.1, high: 338, low: 329.5, volume: 41234567 });
  });
  it("Stooq-Format (englisch und polnisch)", () => {
    const en = parsePriceCsv("Date,Open,High,Low,Close,Volume\n2026-10-08,328,332,327.1,331.2,39000000\n2026-10-09,330.1,338,329.5,336.64,41234567\n");
    expect(en.bars).toHaveLength(2);
    const pl = parsePriceCsv("Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen\n2026-10-09,330.1,338,329.5,336.64,41234567\n");
    expect(pl.bars[0]).toMatchObject({ close: 336.64, high: 338 });
  });
  it("Schrägstrich-Datum: Reihenfolge nur aus eindeutigen Daten, sonst Ablehnung", () => {
    expect(parsePriceCsv("Date,Close\n25/09/2026,10\n01/10/2026,11\n").bars.map((b) => b.date)).toEqual(["2026-09-25", "2026-10-01"]);
    expect(() => parsePriceCsv("Date,Close\n01/02/2026,10\n03/04/2026,11\n")).toThrow(/nicht eindeutig/);
  });
});
