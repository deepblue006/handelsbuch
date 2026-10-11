/**
 * Alpha Vantage – Parser (rein, gegen echte Antworten getestet) und Client.
 * Formate verifiziert anhand echter Antworten vom 11.10.2026 (data/snapshots/alphavantage).
 */
import { z } from "zod";
import { fetchWithRetry, ProviderError, RateLimiter } from "./http";
import type { BarSeries, DailyBar, EarningsData, MacroSeriesData, QuoteData } from "./types";
import { isoWeekKey } from "../calc/indicators";

const BASE = "https://www.alphavantage.co/query";

// ---------- Fehlererkennung ----------

/** Alpha Vantage antwortet bei Limits/Fehlern mit HTTP 200 und Textfeldern. */
export function detectAvError(json: unknown): ProviderError | null {
  if (!json || typeof json !== "object") return new ProviderError("Leere oder ungültige Antwort", "FORMAT");
  const o = json as Record<string, unknown>;
  const msg = (o["Note"] ?? o["Information"] ?? o["Error Message"]) as string | undefined;
  const wrapped = o["error"] as { type?: string; message?: string } | undefined;
  const text = msg ?? wrapped?.message;
  if (!text) return null;
  if (/premium/i.test(text)) return new ProviderError(`Premium-Funktion: ${text}`, "PREMIUM", undefined, false);
  if (/rate limit|requests per day|spreading out|frequency/i.test(text)) return new ProviderError(`Limit erreicht: ${text}`, "RATE_LIMIT", 429, false);
  if (o["Error Message"]) return new ProviderError(`Fehler: ${text}`, "HTTP", 400, false);
  return new ProviderError(text, "FORMAT");
}

const num = (s: unknown): number | null => {
  if (s === undefined || s === null || s === "" || s === "." || s === "None" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------- Zeitreihen ----------

const OhlcvSchema = z.record(z.string(), z.record(z.string(), z.string()));

function pickField(row: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) if (row[n] !== undefined) return row[n];
  return undefined;
}

export function parseTimeSeries(json: unknown, interval: "DAY" | "WEEK", currency: string, today?: string): BarSeries {
  const err = detectAvError(json);
  if (err) throw err;
  const o = json as Record<string, unknown>;
  const meta = (o["Meta Data"] ?? {}) as Record<string, string>;
  const key = Object.keys(o).find((k) => k !== "Meta Data" && /Time Series/i.test(k));
  if (!key) throw new ProviderError("Zeitreihe fehlt in der Antwort", "FORMAT");
  const parsed = OhlcvSchema.safeParse(o[key]);
  if (!parsed.success) throw new ProviderError("Zeitreihe hat unerwartetes Format", "FORMAT");
  const bars: DailyBar[] = [];
  for (const [date, row] of Object.entries(parsed.data)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const close = num(pickField(row, ["4. close", "4a. close (USD)"]));
    if (close == null || close <= 0) continue; // ungültige Zeile verwerfen, nicht schätzen
    bars.push({
      date,
      open: num(pickField(row, ["1. open", "1a. open (USD)"])),
      high: num(pickField(row, ["2. high", "2a. high (USD)"])),
      low: num(pickField(row, ["3. low", "3a. low (USD)"])),
      close,
      volume: num(pickField(row, ["5. volume", "6. volume"])),
    });
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  const lastRefreshed = (meta["3. Last Refreshed"] ?? meta["5. Last Refreshed"] ?? meta["6. Last Refreshed"] ?? null)?.slice(0, 10) ?? null;
  const symbol = meta["2. Symbol"] ?? meta["2. Digital Currency Code"] ?? meta["2. From Symbol"] ?? "";
  const lastDate = bars.at(-1)?.date ?? null;
  let partial = false;
  if (today && lastDate) {
    if (interval === "DAY" && lastDate === today) partial = true; // laufender Tag (z. B. Krypto um 00:00 UTC)
    if (interval === "WEEK") {
      // laufende Woche: letzte Kerze liegt in der aktuellen ISO-Woche und heute ist Mo–Fr
      const wd = new Date(today + "T00:00:00Z").getUTCDay();
      partial = isoWeekKey(lastDate) === isoWeekKey(today) && wd >= 1 && wd <= 5;
    }
  }
  return {
    symbol,
    currency,
    interval,
    adjusted: false,
    lastRefreshed,
    timeZone: meta["5. Time Zone"] ?? meta["4. Time Zone"] ?? meta["6. Time Zone"] ?? meta["7. Time Zone"] ?? null,
    bars,
    partialLastBar: partial,
  };
}

// ---------- Makro (Treasury, Fed Funds, WTI, Brent …) ----------

const EconSchema = z.object({
  name: z.string(),
  interval: z.string().optional(),
  unit: z.string(),
  data: z.array(z.object({ date: z.string(), value: z.string() })),
});

export function parseEconomic(json: unknown, key: string): MacroSeriesData {
  const err = detectAvError(json);
  if (err) throw err;
  const p = EconSchema.safeParse(json);
  if (!p.success) throw new ProviderError("Makroreihe hat unerwartetes Format", "FORMAT");
  const points = p.data.data
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d) => ({ date: d.date, value: num(d.value) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { key, name: p.data.name, unit: p.data.unit, points };
}

const GoldSchema = z.object({ nominal: z.string(), data: z.array(z.object({ date: z.string(), price: z.string() })) });

export function parseGoldSilver(json: unknown, key: string): MacroSeriesData {
  const err = detectAvError(json);
  if (err) throw err;
  const p = GoldSchema.safeParse(json);
  if (!p.success) throw new ProviderError("Gold-/Silberreihe hat unerwartetes Format", "FORMAT");
  return {
    key,
    name: p.data.nominal === "XAUUSD" ? "Gold (XAU/USD)" : p.data.nominal,
    unit: "USD je Feinunze",
    points: p.data.data.map((d) => ({ date: d.date, value: num(d.price) })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

/** FX_DAILY → Makroreihe der Schlusskurse (z. B. EURUSD = USD je EUR). */
export function parseFxDaily(json: unknown, key: string): MacroSeriesData {
  const s = parseTimeSeries(json, "DAY", "USD");
  const meta = ((json as Record<string, unknown>)["Meta Data"] ?? {}) as Record<string, string>;
  return {
    key,
    name: `${meta["2. From Symbol"]}/${meta["3. To Symbol"]} Tagesschluss`,
    unit: `${meta["3. To Symbol"]} je ${meta["2. From Symbol"]}`,
    points: s.bars.map((b) => ({ date: b.date, value: b.close })),
  };
}

// ---------- Quote ----------

export function parseGlobalQuote(json: unknown, currency: string): QuoteData {
  const err = detectAvError(json);
  if (err) throw err;
  const q = (json as Record<string, Record<string, string>>)["Global Quote"];
  if (!q || !q["05. price"]) throw new ProviderError("Global Quote leer (Symbol unbekannt?)", "FORMAT");
  return {
    symbol: q["01. symbol"] ?? "",
    last: num(q["05. price"]),
    bid: null,
    ask: null,
    quoteTime: null,
    latestTradingDay: q["07. latest trading day"] ?? null,
    currency,
    delayNote: "Alpha Vantage GLOBAL_QUOTE (Free: Tagesschluss bzw. verzögert; keine Geld-/Briefkurse)",
  };
}

// ---------- Earnings-Kalender (CSV) ----------

export function parseEarningsCsv(csv: string): EarningsData[] {
  if (/^\s*\{/.test(csv)) {
    const err = detectAvError(JSON.parse(csv));
    if (err) throw err;
  }
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const idx = (n: string) => header.indexOf(n);
  if (idx("symbol") < 0 || idx("reportDate") < 0) throw new ProviderError("Earnings-CSV ohne erwartete Spalten", "FORMAT");
  return lines.filter(Boolean).map((l) => {
    const c = l.split(",");
    return {
      symbol: c[idx("symbol")]!,
      reportDate: c[idx("reportDate")]!,
      fiscalPeriodEnd: c[idx("fiscalDateEnding")] || null,
      epsEstimate: num(c[idx("estimate")]),
      currency: c[idx("currency")] || null,
      timeOfDay: idx("timeOfTheDay") >= 0 ? c[idx("timeOfTheDay")] || null : null,
    };
  });
}

// ---------- Kongress-Transaktionen (Sekundärquelle) ----------

export const AvCongressTradeSchema = z.object({
  chamber: z.string(),
  politician: z.string(),
  bioguide_id: z.string().nullable().optional(),
  politician_canonical: z.string().nullable().optional(),
  party: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  state_district: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  ticker_reported: z.string().nullable().optional(),
  ticker_source: z.string().nullable().optional(),
  asset_name: z.string(),
  asset_type_code: z.string().nullable().optional(),
  transaction_type: z.string(),
  transaction_date: z.string().nullable().optional(),
  notification_date: z.string().nullable().optional(),
  amount_min: z.string().nullable().optional(),
  amount_max: z.string().nullable().optional(),
  owner_code: z.string().nullable().optional(),
  filing_status: z.string().nullable().optional(),
  filed_date: z.string().nullable().optional(),
});
export type AvCongressTrade = z.infer<typeof AvCongressTradeSchema>;

export function parseCongressTrades(json: unknown): { trades: AvCongressTrade[]; invalid: number } {
  const err = detectAvError(json);
  if (err) throw err;
  const arr = (json as { trades?: unknown[] }).trades;
  if (!Array.isArray(arr)) throw new ProviderError("Feld 'trades' fehlt", "FORMAT");
  const trades: AvCongressTrade[] = [];
  let invalid = 0;
  for (const t of arr) {
    const p = AvCongressTradeSchema.safeParse(t);
    if (p.success) trades.push(p.data);
    else invalid++;
  }
  return { trades, invalid };
}

// ---------- Client ----------

export class AlphaVantageClient {
  constructor(
    private readonly apiKey: string,
    private readonly limiter: RateLimiter,
    private readonly fetchImpl?: typeof fetch,
  ) {
    if (!apiKey) throw new ProviderError("ALPHAVANTAGE_API_KEY fehlt", "ZUGANG_FEHLT");
  }

  private async get(params: Record<string, string>): Promise<{ text: string; json: unknown | null }> {
    await this.limiter.acquire();
    const qs = new URLSearchParams({ ...params, apikey: this.apiKey });
    const res = await fetchWithRetry(`${BASE}?${qs}`, { fetchImpl: this.fetchImpl, retries: 2, baseDelayMs: 2000 });
    const text = await res.text();
    let json: unknown | null = null;
    try { json = JSON.parse(text); } catch { /* CSV */ }
    return { text, json };
  }

  async dailyCompact(symbol: string, currency: string, today: string) {
    const { json } = await this.get({ function: "TIME_SERIES_DAILY", symbol, outputsize: "compact", datatype: "json" });
    return parseTimeSeries(json, "DAY", currency, today);
  }
  async weekly(symbol: string, currency: string, today: string) {
    const { json } = await this.get({ function: "TIME_SERIES_WEEKLY", symbol, datatype: "json" });
    return parseTimeSeries(json, "WEEK", currency, today);
  }
  async quote(symbol: string, currency: string) {
    const { json } = await this.get({ function: "GLOBAL_QUOTE", symbol, datatype: "json" });
    return parseGlobalQuote(json, currency);
  }
  async treasury10y() {
    const { json } = await this.get({ function: "TREASURY_YIELD", interval: "daily", maturity: "10year", datatype: "json" });
    return parseEconomic(json, "US10Y");
  }
  async fedFunds() {
    const { json } = await this.get({ function: "FEDERAL_FUNDS_RATE", interval: "daily", datatype: "json" });
    return parseEconomic(json, "EFFR");
  }
  async wti() {
    const { json } = await this.get({ function: "WTI", interval: "daily", datatype: "json" });
    return parseEconomic(json, "WTI");
  }
  async brent() {
    const { json } = await this.get({ function: "BRENT", interval: "daily", datatype: "json" });
    return parseEconomic(json, "BRENT");
  }
  async gold() {
    const { json } = await this.get({ function: "GOLD_SILVER_HISTORY", symbol: "GOLD", interval: "daily", datatype: "json" });
    return parseGoldSilver(json, "GOLD_USD");
  }
  async eurusd() {
    const { json } = await this.get({ function: "FX_DAILY", from_symbol: "EUR", to_symbol: "USD", datatype: "json" });
    return parseFxDaily(json, "EURUSD");
  }
  async earnings(symbol: string) {
    const { text } = await this.get({ function: "EARNINGS_CALENDAR", symbol, horizon: "12month" });
    return parseEarningsCsv(text);
  }
  async congressTrades(symbol: string) {
    const { json } = await this.get({ function: "CONGRESS_TRADES", symbol, datatype: "json" });
    return parseCongressTrades(json);
  }
  async cryptoDaily(symbol: string, market: string, today: string) {
    const { json } = await this.get({ function: "DIGITAL_CURRENCY_DAILY", symbol, market, datatype: "json" });
    return parseTimeSeries(json, "DAY", market, today);
  }
}
