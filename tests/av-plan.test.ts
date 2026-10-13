import { describe, it, expect } from "vitest";
import { buildJobs, planJobs, isDue, nextDue, lastUsCloseCutoff, lastWeekCloseCutoff, type AvInstrument } from "@/lib/providers/av-plan";

const inst = (symbol: string, o: Partial<AvInstrument> = {}): AvInstrument => ({
  symbol, assetType: "STOCK", held: true, isIndexProxy: false, isSectorEtf: false, inBreadthUniverse: false,
  splitsManual: false, splitsCheckedAt: null, hasCoinGecko: false, ...o,
});
const SECTORS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"].map((s) => inst(s, { assetType: "ETF", held: false, isSectorEtf: true, splitsCheckedAt: new Date("2026-10-01T00:00:00Z") }));
const PROXIES = ["SPY", "QQQ", "IWM"].map((s) => inst(s, { assetType: "INDEX_PROXY", held: false, isIndexProxy: true, splitsCheckedAt: new Date("2026-10-01T00:00:00Z") }));

describe("Fälligkeit je Datensatz", () => {
  // Dienstag, 13.10.2026, 16:00 UTC (vor US-Handelsschluss)
  const tue = new Date("2026-10-13T16:00:00Z");
  it("Handelsschluss-Grenze: vor 22:15 UTC zählt der Vortag, am Wochenende der Freitag", () => {
    expect(lastUsCloseCutoff(tue).toISOString()).toBe("2026-10-12T22:15:00.000Z");
    expect(lastUsCloseCutoff(new Date("2026-10-13T23:00:00Z")).toISOString()).toBe("2026-10-13T22:15:00.000Z");
    expect(lastUsCloseCutoff(new Date("2026-10-18T12:00:00Z")).toISOString()).toBe("2026-10-16T22:15:00.000Z"); // Sonntag → Freitag
    expect(lastWeekCloseCutoff(tue).toISOString()).toBe("2026-10-09T22:15:00.000Z");
  });
  it("Wochenkurse sind erst nach dem nächsten Wochenschluss wieder fällig", () => {
    const fetchedSat = new Date("2026-10-10T08:00:00Z");
    expect(isDue("weekly", fetchedSat, tue)).toBe(false);
    expect(isDue("weekly", fetchedSat, new Date("2026-10-16T23:00:00Z"))).toBe(true);
    expect(nextDue("weekly", fetchedSat, tue).toISOString().slice(0, 13)).toBe("2026-10-16T23");
  });
  it("Tageskurse: einmal je Handelstag; am Wochenende kein erneuter Abruf", () => {
    expect(isDue("daily", new Date("2026-10-12T23:00:00Z"), tue)).toBe(false);
    expect(isDue("daily", new Date("2026-10-12T20:00:00Z"), tue)).toBe(true);
    expect(isDue("daily", new Date("2026-10-16T23:00:00Z"), new Date("2026-10-18T12:00:00Z"))).toBe(false);
  });
  it("13F monatlich, Konsens wöchentlich, nie abgerufen = fällig", () => {
    expect(isDue("institutional", new Date("2026-09-20T00:00:00Z"), tue)).toBe(false);
    expect(isDue("institutional", new Date("2026-09-10T00:00:00Z"), tue)).toBe(true);
    expect(isDue("estimates", new Date("2026-10-08T00:00:00Z"), tue)).toBe(false);
    expect(isDue("estimates", null, tue)).toBe(true);
  });
});

describe("Abrufplan im Tageskontingent", () => {
  const now = new Date("2026-10-13T23:00:00Z");
  const all = [...PROXIES, ...SECTORS, inst("AAPL"), inst("NVDA"), inst("BTC", { assetType: "CRYPTO" })];

  it("ohne Vorabrufe übersteigt der Bedarf 25 Abrufe; Wichtiges zuerst, Sektor-Wochenkurse und Splits zuletzt", () => {
    const jobs = buildJobs(all, now);
    const p = planJobs(jobs, new Map(), now, 25);
    expect(jobs.length).toBeGreaterThan(25);
    expect(p.run).toHaveLength(25);
    expect(p.run.slice(0, 5).every((j) => j.kind === "daily")).toBe(true);
    expect(p.run.findIndex((j) => j.kind === "macro")).toBeLessThan(p.run.findIndex((j) => j.kind === "weekly"));
    expect(p.deferred.some((j) => j.dataset === "weekly:XLK")).toBe(true);
    expect(p.deferred.at(-1)!.kind).toBe("splits");
    // Sektor-ETFs bekommen keine Tageskurse
    expect(jobs.some((j) => j.dataset === "daily:XLK")).toBe(false);
  });

  it("nach einem Wochenabruf belegen Sektor-ETFs das Kontingent unter der Woche nicht mehr", () => {
    const jobs = buildJobs(all, now);
    const sat = new Date("2026-10-10T08:00:00Z");
    const last = new Map<string, Date>();
    for (const j of jobs) if (j.kind !== "daily" && j.kind !== "macro" && j.kind !== "congress") last.set(j.dataset, sat);
    const p = planJobs(jobs, last, now, 25);
    expect(p.run.map((j) => j.kind).every((k) => k === "daily" || k === "macro" || k === "congress" || k === "crypto" || k === "splits")).toBe(true);
    expect(p.deferred).toEqual([]);
    expect(p.notDue.some((n) => n.job.dataset === "weekly:XLK")).toBe(true);
  });

  it("verbrauchtes Kontingent: nichts wird ausgeführt, alles Fällige aufgeschoben", () => {
    const p = planJobs(buildJobs(all, now), new Map(), now, -3);
    expect(p.run).toEqual([]);
    expect(p.remaining).toBe(0);
    expect(p.deferred.length).toBeGreaterThan(0);
  });

  it("CoinGecko-Schlüssel vorhanden → Krypto nicht über Alpha Vantage; manuell bestätigte Splits nicht abfragen", () => {
    const jobs = buildJobs([inst("BTC", { assetType: "CRYPTO", hasCoinGecko: true }), inst("AAPL", { splitsManual: true })], now);
    expect(jobs.some((j) => j.kind === "crypto")).toBe(false);
    expect(jobs.some((j) => j.kind === "splits")).toBe(false);
  });
});
