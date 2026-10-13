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

  it("Erschöpftes Alpha-Vantage-Kontingent: kein Abrufversuch, ein einziger Aufschub-Eintrag, kein falscher Erfolg", async () => {
    const refresh = await import("@/lib/server/refresh");
    await prisma.fetchLog.deleteMany({ where: { providerId: "alphavantage" } });
    await prisma.providerState.deleteMany({ where: { providerId: "alphavantage" } });
    // 25 heutige Abrufe (FAILED zählt als verbrauchter Abruf, aber nicht als Erfolg)
    await prisma.fetchLog.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ providerId: "alphavantage", dataset: `test:${i}`, startedAt: new Date(), finishedAt: new Date(), status: "FAILED" as const })) });
    await ingest.ensureInstrument({ symbol: "MSFT", name: "Microsoft", assetType: "STOCK", currency: "USD", onWatchlist: true });
    const out = await refresh.refreshAlphaVantage();
    expect(out.map((o) => o.dataset)).toEqual(["kontingent"]);
    const logs = await prisma.fetchLog.findMany({ where: { providerId: "alphavantage", dataset: { not: { startsWith: "test:" } } } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ dataset: "kontingent", status: "SKIPPED" });
    expect(logs[0]!.errorMessage).toContain("daily:MSFT");
    expect((await prisma.providerState.findUnique({ where: { providerId: "alphavantage" } }))?.lastSuccessAt ?? null).toBeNull();
  });

  it("CoinGecko-Job (synthetische Antworten): Kurs mit Anbieter-Zeitstempel, Marktdaten, Tageskurse ohne laufenden Tag, Gesamtmarkt", async () => {
    const refresh = await import("@/lib/server/refresh");
    const data = await import("@/lib/server/data");
    const { vi } = await import("vitest");
    const btc = await ingest.ensureInstrument({ symbol: "BTCCG", name: "Bitcoin", assetType: "CRYPTO", currency: "EUR", providerIds: { coingecko: "bitcoin" }, onWatchlist: true });
    await prisma.fetchLog.deleteMany({ where: { providerId: "coingecko" } });
    const today = new Date().toISOString().slice(0, 10);
    const day = (offset: number) => Date.parse(today + "T00:00:00Z") + offset * 86400000;
    const routes: Record<string, unknown> = {
      "/coins/markets": [{ id: "bitcoin", current_price: 61000, last_updated: new Date(Date.now() - 60_000).toISOString(), market_cap: 1.2e12, total_volume: 3e10, circulating_supply: 1.99e7, ath: 99000, ath_change_percentage: -38.4, ath_date: "2026-01-14T00:00:00Z" }],
      "/coins/bitcoin/market_chart": { prices: [[day(-2), 59000], [day(-1), 60000], [Date.now(), 61000]], total_volumes: [[day(-1), 1]] },
      "/global": { data: { total_market_cap: { eur: 2.1e12 }, market_cap_percentage: { btc: 56.2 }, updated_at: Math.floor(Date.now() / 1000) } },
    };
    const urls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (u: string | URL) => {
      urls.push(String(u));
      const body = routes[new URL(String(u)).pathname.replace("/api/v3", "")];
      return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
    }) as typeof fetch);
    process.env.COINGECKO_API_KEY = "CG-synthetisch-1234567";
    try {
      const out = await refresh.refreshCoinGecko();
      expect(out.filter((o) => !o.ok)).toEqual([]);
    } finally {
      spy.mockRestore();
      delete process.env.COINGECKO_API_KEY;
    }
    expect(urls.every((u) => !u.includes("CG-synthetisch"))).toBe(true);
    const bars = await prisma.priceBar.findMany({ where: { instrumentId: btc.id, provider: "coingecko" }, orderBy: { date: "asc" } });
    expect(bars.map((b) => b.close)).toEqual([59000, 60000]); // laufender UTC-Tag verworfen
    const price = await data.latestPrice(btc);
    expect(price).toMatchObject({ price: 61000, source: "coingecko", interval: "QUOTE" });
    const market = (await prisma.setting.findUnique({ where: { key: "cg:market:BTCCG" } }))?.value as { athChangePct: number; missingFields: string[] };
    expect(market.athChangePct).toBe(-38.4);
    expect(market.missingFields).toEqual([]);
    expect(((await prisma.setting.findUnique({ where: { key: "cg:global" } }))?.value as { dominancePct: { btc: number } }).dominancePct.btc).toBe(56.2);
    expect(await ingest.countSuccessThisMonth("coingecko")).toBe(3);
  });

  it("Truth-Social-Archivquelle (synthetischer Feed): erst nach Aktivierung, ohne Dubletten, Text bleibt beim ersten Stand, Größenlimit", async () => {
    const refresh = await import("@/lib/server/refresh");
    const { vi } = await import("vitest");
    await prisma.socialPost.deleteMany({});
    await prisma.setting.deleteMany({ where: { key: "truthFeedPreset" } });
    await prisma.providerState.upsert({ where: { providerId: "truthsocial" }, create: { providerId: "truthsocial", enabled: true }, update: { enabled: true } });
    delete process.env.TRUTHSOCIAL_FEED_URL;
    const item = (n: string, text: string) => `<item><link>https://trumpstruth.org/statuses/${n}</link><guid>https://trumpstruth.org/statuses/${n}</guid><pubDate>Sun, 11 Oct 2026 21:0${n.slice(-1)}:00 GMT</pubDate><description>${text} https://truthsocial.com/@realDonaldTrump/11500000000000000${n.slice(-1)}</description></item>`;
    let body = `<?xml version="1.0"?><rss version="2.0"><channel>${item("41", "Erster Text")}${item("42", "Zweiter Text")}</channel></rss>`;
    const urls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((async (u: string | URL) => { urls.push(String(u)); return new Response(body, { status: 200 }); }) as typeof fetch);
    try {
      // ohne Aktivierung: kein Abruf
      expect((await refresh.refreshTruthSocial())[0]!.ok).toBe(false);
      expect(urls).toEqual([]);
      await prisma.setting.create({ data: { key: "truthFeedPreset", value: { active: true } } });
      const first = (await refresh.refreshTruthSocial())[0]!;
      expect(first).toMatchObject({ ok: true, info: "2 Posts" });
      expect(urls[0]).toContain("trumpstruth.org/feed");
      // zweiter Abruf: Quelle ergänzt Text (z. B. Transkript) → gespeicherter Text bleibt unverändert, keine Dublette
      body = body.replace("Erster Text", "Erster Text [Transkript]");
      await refresh.refreshTruthSocial();
      const posts = await prisma.socialPost.findMany({ orderBy: { createdAt: "asc" } });
      expect(posts).toHaveLength(2);
      expect(posts[0]!.text).toBe("Erster Text https://truthsocial.com/@realDonaldTrump/115000000000000001");
      expect(posts[0]!.url).toBe("https://truthsocial.com/@realDonaldTrump/posts/115000000000000001");
      expect(posts[0]!.sourceUrl).toBe("https://trumpstruth.org/statuses/41");
      expect(posts[0]!.provider).toBe("Trump's Truth (trumpstruth.org)");
      // übergroßer Feed wird abgelehnt
      body = "x".repeat(5_000_001);
      const big = await refresh.refreshTruthSocial();
      expect(big[0]!.ok).toBe(false);
      expect(big[0]!.info).toContain("Feed zu groß");
    } finally {
      spy.mockRestore();
    }
  });
});
