/**
 * CoinGecko Demo-API (kostenlos, Registrierung + Demo-Schlüssel nötig).
 *
 * Laut offizieller Doku (über Websuche-Auszüge geprüft, 13.10.2026; die Doku-Seiten selbst sind aus der
 * Entwicklungsumgebung gesperrt):
 * - Basis-URL https://api.coingecko.com/api/v3/, Schlüssel per Header `x-cg-demo-api-key`
 *   (Query-Parameter möglich, aber nicht empfohlen – wir nutzen ausschließlich den Header).
 * - Jede erfolgreiche Anfrage (HTTP 200) kostet 1 Credit vom Monatskontingent.
 * - /coins/{id}/market_chart: Demo nur letzte 365 Tage; interval=daily → Tageswerte (00:00 UTC);
 *   der letzte abgeschlossene UTC-Tag ist erst kurz nach Mitternacht UTC verfügbar.
 * - /global: Cache/Aktualisierung alle 10 Minuten; Felder total_market_cap, market_cap_percentage,
 *   market_cap_change_percentage_24h_usd, updated_at.
 * Nicht offiziell bestätigt: Demo-Limits (Dritte: 100/min, 10.000/Monat) und die Feldnamen von /coins/markets –
 * der Parser meldet fehlende Felder, statt Werte zu raten.
 */
import { z } from "zod";
import { fetchWithRetry, ProviderError, RateLimiter } from "./http";
import type { DailyBar } from "./types";

export const CG_BASE = "https://api.coingecko.com/api/v3";

/**
 * Bekannte CoinGecko-IDs für verbreitete Coins (Ticker sind nicht eindeutig – Zuordnung wird als
 * „automatisch“ gekennzeichnet und kann auf der Detailseite korrigiert werden).
 */
export const KNOWN_COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", DOT: "polkadot",
  LTC: "litecoin", LINK: "chainlink", AVAX: "avalanche-2", BNB: "binancecoin", TRX: "tron", XLM: "stellar",
  USDT: "tether", USDC: "usd-coin", ATOM: "cosmos", BCH: "bitcoin-cash",
};

/** CoinGecko-IDs bestehen aus Kleinbuchstaben, Ziffern und Bindestrichen. */
export const isCoinGeckoId = (s: string) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(s);
export const CG_ATTRIBUTION = { text: "Daten: CoinGecko", url: "https://www.coingecko.com/" };

// ---------- market_chart (Tageskurse) ----------

const MarketChartSchema = z.object({ prices: z.array(z.tuple([z.number(), z.number()])), total_volumes: z.array(z.tuple([z.number(), z.number()])).optional(), market_caps: z.array(z.tuple([z.number(), z.number()])).optional() });

/** /coins/{id}/market_chart → Tagesschlusskurse (UTC-Tag; ein Punkt am heutigen UTC-Tag ist ein laufender Wert). */
export function parseCoinGeckoChart(json: unknown, today: string): { bars: DailyBar[]; marketCap: number | null; partialLast: boolean } {
  const p = MarketChartSchema.safeParse(json);
  if (!p.success) throw new ProviderError("CoinGecko-Antwort hat unerwartetes Format", "FORMAT");
  const vol = new Map((p.data.total_volumes ?? []).map(([t, v]) => [new Date(t).toISOString().slice(0, 10), v]));
  const byDay = new Map<string, number>();
  for (const [t, v] of p.data.prices) byDay.set(new Date(t).toISOString().slice(0, 10), v); // letzter Wert je Tag
  const bars = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, close]) => ({ date, open: null, high: null, low: null, close, volume: vol.get(date) ?? null }));
  const mc = p.data.market_caps?.at(-1)?.[1] ?? null;
  return { bars, marketCap: mc, partialLast: bars.at(-1)?.date === today };
}

// ---------- coins/markets (Kurs + Marktdaten, mehrere Coins je Anfrage) ----------

const numOrNull = z.number().nullable().optional();
const MarketRowSchema = z.object({
  id: z.string(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  current_price: numOrNull,
  market_cap: numOrNull,
  market_cap_rank: numOrNull,
  total_volume: numOrNull,
  price_change_percentage_24h: numOrNull,
  circulating_supply: numOrNull,
  total_supply: numOrNull,
  max_supply: numOrNull,
  ath: numOrNull,
  ath_change_percentage: numOrNull,
  ath_date: z.string().nullable().optional(),
  last_updated: z.string().nullable().optional(),
});

export interface CoinMarket {
  id: string;
  price: number | null;
  lastUpdated: string | null; // ISO-Zeitpunkt laut CoinGecko
  marketCap: number | null;
  rank: number | null;
  volume24h: number | null;
  change24hPct: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  ath: number | null;
  athDate: string | null;
  athChangePct: number | null;
}

/** Erwartete Felder; fehlen sie in der Antwort, wird das ausgewiesen (Format live noch ungeprüft). */
export const MARKET_FIELDS = ["current_price", "last_updated", "market_cap", "total_volume", "circulating_supply", "ath", "ath_change_percentage", "ath_date"] as const;

export function parseCoinMarkets(json: unknown): { coins: CoinMarket[]; missingFields: string[]; invalid: number } {
  if (!Array.isArray(json)) {
    const err = (json as { status?: { error_message?: string }; error?: string } | null);
    throw new ProviderError(`CoinGecko /coins/markets: unerwartetes Format${err?.status?.error_message ? ` (${err.status.error_message})` : err?.error ? ` (${err.error})` : ""}`, "FORMAT");
  }
  const missing = new Set<string>();
  let invalid = 0;
  const coins = json.flatMap((row) => {
    const p = MarketRowSchema.safeParse(row);
    if (!p.success) { invalid++; return []; }
    for (const f of MARKET_FIELDS) if (!(f in (row as object))) missing.add(f);
    const r = p.data;
    const iso = (s: string | null | undefined) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);
    return [{
      id: r.id, price: r.current_price ?? null, lastUpdated: iso(r.last_updated), marketCap: r.market_cap ?? null, rank: r.market_cap_rank ?? null,
      volume24h: r.total_volume ?? null, change24hPct: r.price_change_percentage_24h ?? null, circulatingSupply: r.circulating_supply ?? null,
      totalSupply: r.total_supply ?? null, maxSupply: r.max_supply ?? null, ath: r.ath ?? null, athDate: iso(r.ath_date), athChangePct: r.ath_change_percentage ?? null,
    }];
  });
  return { coins, missingFields: [...missing], invalid };
}

// ---------- global (Gesamtmarkt) ----------

const GlobalSchema = z.object({
  data: z.object({
    total_market_cap: z.record(z.string(), z.number()),
    total_volume: z.record(z.string(), z.number()).optional(),
    market_cap_percentage: z.record(z.string(), z.number()),
    market_cap_change_percentage_24h_usd: z.number().nullable().optional(),
    updated_at: z.number(),
  }),
});

export interface CryptoGlobal {
  totalMarketCap: Record<string, number>;
  totalVolume: Record<string, number>;
  dominancePct: Record<string, number>;
  change24hUsdPct: number | null;
  updatedAt: string; // ISO
}

export function parseGlobal(json: unknown): CryptoGlobal {
  const p = GlobalSchema.safeParse(json);
  if (!p.success) throw new ProviderError("CoinGecko /global: unerwartetes Format", "FORMAT");
  const d = p.data.data;
  // updated_at: Unix-Zeit; Sekunden (Doku-Beispiel 10-stellig) – Millisekunden werden erkannt
  const ms = d.updated_at > 1e12 ? d.updated_at : d.updated_at * 1000;
  return { totalMarketCap: d.total_market_cap, totalVolume: d.total_volume ?? {}, dominancePct: d.market_cap_percentage, change24hUsdPct: d.market_cap_change_percentage_24h_usd ?? null, updatedAt: new Date(ms).toISOString() };
}

// ---------- Client ----------

export interface CgBudget { used: number; limit: number }

export class CoinGeckoClient {
  constructor(
    private readonly apiKey: string,
    private readonly limiter: RateLimiter,
    /** Monatskontingent (Credits); Abrufe stoppen bei 95 %, damit manuelle Nutzung möglich bleibt. */
    private readonly budget: () => Promise<CgBudget>,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!apiKey) throw new ProviderError("COINGECKO_API_KEY fehlt (kostenloser Demo-Schlüssel)", "ZUGANG_FEHLT");
  }

  private async get(path: string, params: Record<string, string>) {
    const b = await this.budget();
    if (b.used >= Math.floor(b.limit * 0.95)) throw new ProviderError(`Monatskontingent nahezu erschöpft (${b.used}/${b.limit} Credits)`, "RATE_LIMIT", 429, false);
    await this.limiter.acquire();
    const url = `${CG_BASE}${path}?${new URLSearchParams(params).toString()}`;
    // Schlüssel nur im Header – nie in der URL (die URL landet in Fehlermeldungen/Protokollen)
    const res = await fetchWithRetry(url, { headers: { "x-cg-demo-api-key": this.apiKey, Accept: "application/json" }, fetchImpl: this.fetchImpl });
    return res.json() as Promise<unknown>;
  }

  async chart(id: string, vsCurrency: string, today: string) {
    return parseCoinGeckoChart(await this.get(`/coins/${encodeURIComponent(id)}/market_chart`, { vs_currency: vsCurrency.toLowerCase(), days: "365", interval: "daily" }), today);
  }
  async markets(ids: string[], vsCurrency: string) {
    return parseCoinMarkets(await this.get("/coins/markets", { vs_currency: vsCurrency.toLowerCase(), ids: ids.join(","), per_page: String(Math.min(250, Math.max(1, ids.length))), page: "1" }));
  }
  async global() {
    return parseGlobal(await this.get("/global", {}));
  }
}
