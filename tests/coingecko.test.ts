// secret-check: synthetische Testwerte – enthält absichtlich gefälschte Schlüssel zur Prüfung, dass sie nicht in URLs landen
/**
 * CoinGecko-Adapter. Alle Antworten hier sind SYNTHETISCH (Struktur nach Doku bzw. erwartetem Format),
 * keine echten Marktdaten – api.coingecko.com ist aus der Entwicklungsumgebung gesperrt.
 */
import { describe, it, expect } from "vitest";
import { parseCoinMarkets, parseGlobal, parseCoinGeckoChart, CoinGeckoClient, CG_BASE } from "@/lib/providers/coingecko";
import { RateLimiter, ProviderError } from "@/lib/providers/http";
import { redact } from "@/lib/security/redact";

const KEY = "CG-synthetischer-test-key-0815";
const marketRow = {
  id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 61000.5, market_cap: 1.2e12, market_cap_rank: 1, total_volume: 3.1e10,
  price_change_percentage_24h: -1.25, circulating_supply: 19_900_000, total_supply: 21_000_000, max_supply: 21_000_000,
  ath: 99000, ath_change_percentage: -38.4, ath_date: "2026-01-14T10:00:00.000Z", last_updated: "2026-10-13T18:59:30.123Z",
};

function fakeFetch(routes: Record<string, unknown>, calls: { url: string; headers: Record<string, string> }[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    const path = new URL(u).pathname.replace("/api/v3", "");
    const body = routes[path];
    if (body === undefined) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    if (body === 429) return new Response("{}", { status: 429 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("CoinGecko-Parser", () => {
  it("/coins/markets: Kurs, Zeitstempel und Marktdaten; fehlende Felder werden gemeldet statt geraten", () => {
    const r = parseCoinMarkets([marketRow, { id: "ethereum", current_price: 2400, last_updated: "2026-10-13T18:59:00Z" }, { foo: 1 }]);
    expect(r.coins).toHaveLength(2);
    expect(r.coins[0]).toMatchObject({ id: "bitcoin", price: 61000.5, lastUpdated: "2026-10-13T18:59:30.123Z", athChangePct: -38.4, maxSupply: 21_000_000 });
    expect(r.coins[1]).toMatchObject({ id: "ethereum", marketCap: null, ath: null });
    expect(r.missingFields).toEqual(expect.arrayContaining(["market_cap", "ath", "circulating_supply"]));
    expect(r.invalid).toBe(1);
  });
  it("/coins/markets: Fehlerobjekt statt Liste → Formatfehler mit Anbietermeldung", () => {
    expect(() => parseCoinMarkets({ status: { error_code: 10002, error_message: "API Key Missing" } })).toThrow(/API Key Missing/);
  });
  it("/global: Dominanz, Gesamtmarkt, Zeitstempel (Sekunden und Millisekunden)", () => {
    const g = parseGlobal({ data: { total_market_cap: { usd: 2.3e12, eur: 2.1e12 }, total_volume: { usd: 9e10 }, market_cap_percentage: { btc: 56.2, eth: 12.1 }, market_cap_change_percentage_24h_usd: -0.8, updated_at: 1791917700 } });
    expect(g.dominancePct.btc).toBe(56.2);
    expect(g.updatedAt).toBe(new Date(1791917700 * 1000).toISOString());
    expect(parseGlobal({ data: { total_market_cap: {}, market_cap_percentage: {}, updated_at: 1791917700000 } }).updatedAt).toBe(new Date(1791917700000).toISOString());
    expect(() => parseGlobal({ data: { total_market_cap: {} } })).toThrow();
  });
  it("market_chart: laufender UTC-Tag wird als unvollständig erkannt", () => {
    const d = (s: string) => Date.parse(s);
    const r = parseCoinGeckoChart({ prices: [[d("2026-10-12T00:00:00Z"), 60000], [d("2026-10-13T00:00:00Z"), 61000], [d("2026-10-13T19:00:00Z"), 61100]] }, "2026-10-13");
    expect(r.partialLast).toBe(true);
    expect(r.bars.map((b) => b.close)).toEqual([60000, 61100]);
  });
});

describe("CoinGecko-Client", () => {
  const limiter = () => new RateLimiter(0, null, async () => 0, async () => undefined);
  it("Schlüssel nur im Header, nie in der URL; Parameter laut Doku", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const c = new CoinGeckoClient(KEY, limiter(), async () => ({ used: 0, limit: 10_000 }), fakeFetch({ "/coins/markets": [marketRow], "/global": { data: { total_market_cap: {}, market_cap_percentage: {}, updated_at: 1 } }, "/coins/bitcoin/market_chart": { prices: [] } }, calls));
    await c.markets(["bitcoin", "ethereum"], "EUR");
    await c.chart("bitcoin", "EUR", "2026-10-13");
    await c.global();
    for (const call of calls) {
      expect(call.url.startsWith(CG_BASE)).toBe(true);
      expect(call.url).not.toContain(KEY);
      expect(call.headers["x-cg-demo-api-key"]).toBe(KEY);
    }
    expect(calls[0]!.url).toContain("vs_currency=eur");
    expect(calls[0]!.url).toContain("ids=bitcoin%2Cethereum");
    expect(calls[1]!.url).toContain("days=365");
    expect(calls[1]!.url).toContain("interval=daily");
  });
  it("ohne Schlüssel: Zugang fehlt (kein stiller Fehlschlag)", () => {
    expect(() => new CoinGeckoClient("", limiter(), async () => ({ used: 0, limit: 1 }))).toThrow(ProviderError);
  });
  it("Monatskontingent: ab 95 % keine Anfrage mehr", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const c = new CoinGeckoClient(KEY, limiter(), async () => ({ used: 9_500, limit: 10_000 }), fakeFetch({ "/global": {} }, calls));
    await expect(c.global()).rejects.toMatchObject({ kind: "RATE_LIMIT" });
    expect(calls).toHaveLength(0);
  });
  it("Fehlermeldungen enthalten den Schlüssel nicht (auch nicht nach Schwärzung)", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const c = new CoinGeckoClient(KEY, limiter(), async () => ({ used: 0, limit: 10_000 }), fakeFetch({}, calls));
    const err = (await c.global().then(() => null, (e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).not.toContain(KEY);
    expect(redact(err, { COINGECKO_API_KEY: KEY })).not.toContain(KEY);
  });
});
