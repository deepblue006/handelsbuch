// secret-check: synthetische Testwerte – enthält absichtlich gefälschte Schlüssel zur Prüfung der Schwärzung
/**
 * Integrationstests gegen eine echte PostgreSQL-Testdatenbank.
 * Werden nur ausgeführt, wenn TEST_DATABASE_URL gesetzt ist (siehe docs/BETRIEB.md).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../helpers";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("Datenbank-Integration", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let ingest: typeof import("@/lib/server/ingest");
  let av: typeof import("@/lib/providers/alphavantage");
  let pol: typeof import("@/lib/politics/normalize");
  let http: typeof import("@/lib/providers/http");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.ALPHAVANTAGE_API_KEY = "geheimer-test-key-123";
    ({ prisma } = await import("@/lib/db"));
    ingest = await import("@/lib/server/ingest");
    av = await import("@/lib/providers/alphavantage");
    pol = await import("@/lib/politics/normalize");
    http = await import("@/lib/providers/http");
    await prisma.$executeRawUnsafe(`TRUNCATE "PoliticianTransaction","PriceBar","FetchLog","ProviderState","Instrument" CASCADE`);
  });

  it("Kursimport ist idempotent und behält Herkunft", async () => {
    const inst = await ingest.ensureInstrument({ symbol: "SPY", name: "SPY", assetType: "INDEX_PROXY", currency: "USD" });
    const s = av.parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD", "2026-10-11");
    const at = new Date("2026-10-11T14:22:00Z");
    await ingest.upsertBars(inst.id, s, "test", at);
    await ingest.upsertBars(inst.id, s, "test", at);
    expect(await prisma.priceBar.count({ where: { instrumentId: inst.id } })).toBe(1405);
    const last = await prisma.priceBar.findFirst({ where: { instrumentId: inst.id }, orderBy: { date: "desc" } });
    expect(last).toMatchObject({ close: 778.57, provider: "test", adjusted: false, currency: "USD" });
  });

  it("Fehlgeschlagener Abruf wird protokolliert – ohne Secret, mit nächstem Versuch", async () => {
    const r = await ingest.withFetchLog("alphavantage", "daily:X", async () => { throw new http.ProviderError("Netzwerkfehler bei https://www.alphavantage.co/query?function=X&apikey=geheimer-test-key-123", "NETZWERK", undefined, true); });
    expect(r.ok).toBe(false);
    const log = await prisma.fetchLog.findFirstOrThrow({ where: { dataset: "daily:X" } });
    expect(log.status).toBe("FAILED");
    expect(log.errorMessage).not.toContain("geheimer-test-key-123");
    expect(log.nextAttemptAt).not.toBeNull();
    const st = await prisma.providerState.findUniqueOrThrow({ where: { providerId: "alphavantage" } });
    expect(st.lastError).not.toContain("geheimer");
  });

  it("Fehlender Zugang wird als übersprungen protokolliert, nicht als Störung", async () => {
    await ingest.withFetchLog("fred", "fred:US10Y", async () => { throw new http.ProviderError("FRED_API_KEY fehlt", "ZUGANG_FEHLT"); });
    expect((await prisma.fetchLog.findFirstOrThrow({ where: { dataset: "fred:US10Y" } })).status).toBe("SKIPPED");
  });

  it("Politikermeldungen: zweiter Import erzeugt keine Dubletten, Korrekturen versioniert", async () => {
    const rows = av.parseCongressTrades(loadSnapshot("CONGRESS_TRADES_NVDA.json")).trades.map(pol.fromAlphaVantage);
    const a = await ingest.ingestPoliticianTx(rows, new Date(), "2026-10-11");
    const b = await ingest.ingestPoliticianTx(rows, new Date(), "2026-10-11");
    expect(a).toMatchObject({ SUPERSEDE: 4, DELETE_MARK: 1, REVIEW: 1, DUPLICATE: 0 });
    expect(b.DUPLICATE).toBe(436);
    expect(await prisma.politicianTransaction.count({ where: { isCurrent: false } })).toBe(5);
    const v2 = await prisma.politicianTransaction.findMany({ where: { version: 2 } });
    expect(v2).toHaveLength(4);
    const replaced = await prisma.politicianTransaction.findFirstOrThrow({ where: { supersededById: v2[0]!.id } });
    expect(replaced.status).toBe("KORRIGIERT_ODER_ERSETZT");
  });

  it("Splitliste des Providers ersetzt alte Einträge, markiert die Liste als geprüft und bereinigt getBars", async () => {
    const data = await import("@/lib/server/data");
    const inst = await ingest.ensureInstrument({ symbol: "AAPL", name: "Apple", assetType: "STOCK", currency: "USD" });
    const s = av.parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_AAPL.json"), "WEEK", "USD", "2026-10-11");
    await ingest.upsertBars(inst.id, s, "test", new Date("2026-10-11T14:22:00Z"));
    const before = await data.getBars(inst.id, "WEEK");
    expect(data.splitSafe(before)).toBe(false);
    // Erster Abruf mit falschem Zusatzeintrag, zweiter (korrekter) Abruf muss ihn entfernen
    await ingest.upsertSplits(inst.id, [{ date: "2010-01-04", factor: 3 }], "alphavantage", "Test 1", new Date());
    const splits = [{ date: "2000-06-21", factor: 2 }, { date: "2005-02-28", factor: 2 }, { date: "2014-06-09", factor: 7 }, { date: "2020-08-31", factor: 4 }];
    await ingest.upsertSplits(inst.id, splits, "alphavantage", "Test 2", new Date());
    expect(await prisma.stockSplit.count({ where: { instrumentId: inst.id } })).toBe(4);
    const after = await data.getBars(inst.id, "WEEK");
    expect(after.split.verified).toBe(true);
    expect(after.split.verifiedSource).toBe("Test 2");
    expect(after.split.problems).toEqual([]);
    expect(after.split.residualJumps.map((j) => j.date)).toEqual(["2000-09-29"]);
    expect(data.splitSafe(after)).toBe(true);
    // Letzter Kurs unverändert, Kurs vor 2020 durch 4 geteilt
    expect(after.bars.at(-1)!.close).toBe(before.bars.at(-1)!.close);
    const i = before.bars.findIndex((b) => b.date === "2020-08-28");
    expect(after.bars[i]!.close).toBeCloseTo(before.bars[i]!.close / 4, 6);
    // Falsches Datum → Widerspruch erkannt, Liste gilt nicht mehr als passend
    await prisma.stockSplit.create({ data: { instrumentId: inst.id, effectiveDate: new Date("2020-08-24T00:00:00Z"), factor: 4, provider: "manuell", source: "Tippfehler" } });
    const wrong = await data.getBars(inst.id, "WEEK");
    expect(wrong.split.verified).toBe(false);
    expect(wrong.split.problems.length).toBeGreaterThan(0);
  });
});
