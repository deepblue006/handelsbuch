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
  async estimates(symbol: string) {
    const { json } = await this.get({ function: "EARNINGS_ESTIMATES", symbol });
    return parseEarningsEstimates(json);
  }
  async insider(symbol: string, fromDate?: string) {
    const { json } = await this.get({ function: "INSIDER_TRANSACTIONS", symbol, ...(fromDate ? { from_date: fromDate } : {}) });
    return parseInsiderTransactions(json);
  }
  async institutional(symbol: string) {
    const { json } = await this.get({ function: "INSTITUTIONAL_HOLDINGS", symbol });
    return parseInstitutionalHoldings(json);
  }
  async cryptoDaily(symbol: string, market: string, today: string) {
    const { json } = await this.get({ function: "DIGITAL_CURRENCY_DAILY", symbol, market, datatype: "json" });
    return parseTimeSeries(json, "DAY", market, today);
  }
}

// ---------- Analystenschätzungen (EARNINGS_ESTIMATES) ----------

const EstimateSchema = z.object({
  date: z.string(),
  horizon: z.string(),
  eps_estimate_average: z.string().nullable(),
  eps_estimate_high: z.string().nullable().optional(),
  eps_estimate_low: z.string().nullable().optional(),
  eps_estimate_analyst_count: z.string().nullable().optional(),
  eps_estimate_average_30_days_ago: z.string().nullable().optional(),
  eps_estimate_average_90_days_ago: z.string().nullable().optional(),
  eps_estimate_revision_up_trailing_30_days: z.string().nullable().optional(),
  eps_estimate_revision_down_trailing_30_days: z.string().nullable().optional(),
  revenue_estimate_average: z.string().nullable().optional(),
  revenue_estimate_analyst_count: z.string().nullable().optional(),
});

export interface EpsEstimate {
  periodEnd: string;
  horizon: "FY" | "Q";
  eps: number | null;
  epsHigh: number | null;
  epsLow: number | null;
  analysts: number | null;
  eps30dAgo: number | null;
  eps90dAgo: number | null;
  revisionsUp30d: number | null;
  revisionsDown30d: number | null;
  revenue: number | null;
}

export function parseEarningsEstimates(json: unknown): EpsEstimate[] {
  const err = detectAvError(json);
  if (err) throw err;
  const arr = (json as { estimates?: unknown[] }).estimates;
  if (!Array.isArray(arr)) throw new ProviderError("Feld 'estimates' fehlt", "FORMAT");
  return arr.flatMap((e) => {
    const p = EstimateSchema.safeParse(e);
    if (!p.success || !/^\d{4}-\d{2}-\d{2}$/.test(p.data.date)) return [];
    const x = p.data;
    return [{
      periodEnd: x.date,
      horizon: /year/i.test(x.horizon) ? "FY" as const : "Q" as const,
      eps: num(x.eps_estimate_average), epsHigh: num(x.eps_estimate_high), epsLow: num(x.eps_estimate_low),
      analysts: num(x.eps_estimate_analyst_count), eps30dAgo: num(x.eps_estimate_average_30_days_ago), eps90dAgo: num(x.eps_estimate_average_90_days_ago),
      revisionsUp30d: num(x.eps_estimate_revision_up_trailing_30_days), revisionsDown30d: num(x.eps_estimate_revision_down_trailing_30_days),
      revenue: num(x.revenue_estimate_average),
    }];
  });
}

/**
 * FY1 = erstes Geschäftsjahr, dessen Ende NACH dem Stichtag liegt; FY2 = das darauf folgende.
 * Ein bereits beendetes, aber noch nicht berichtetes Geschäftsjahr gilt nicht als „forward“.
 * Erwartetes EPS-Wachstum = FY2 / FY1 − 1 (nur wenn beide positiv).
 */
export function forwardEstimates(est: EpsEstimate[], today: string) {
  const fy = est.filter((e) => e.horizon === "FY" && e.eps != null).sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  const future = fy.filter((e) => e.periodEnd > today);
  const fy1 = future[0] ?? null;
  const fy2 = future[1] ?? null;
  const unreported = fy.filter((e) => e.periodEnd <= today).at(-1) ?? null;
  const growthPct = fy1?.eps && fy2?.eps && fy1.eps > 0 && fy2.eps > 0 ? (fy2.eps / fy1.eps - 1) * 100 : unreported?.eps && fy1?.eps && unreported.eps > 0 && fy1.eps > 0 ? (fy1.eps / unreported.eps - 1) * 100 : null;
  const growthBasis = fy1 && fy2 ? "FY2 ÷ FY1" : unreported && fy1 ? "FY1 ÷ abgelaufenes, noch nicht berichtetes GJ (Schätzung)" : null;
  const revision30dPct = fy1?.eps != null && fy1.eps30dAgo ? ((fy1.eps - fy1.eps30dAgo) / Math.abs(fy1.eps30dAgo)) * 100 : null;
  return { fy1, fy2, unreportedFy: unreported, growthPct, growthBasis, revision30dPct };
}

// ---------- Insidertransaktionen (INSIDER_TRANSACTIONS) ----------

const InsiderSchema = z.object({
  transaction_date: z.string(),
  ticker: z.string(),
  executive: z.string(),
  executive_title: z.string().nullable().optional(),
  security_type: z.string().nullable().optional(),
  acquisition_or_disposal: z.string(),
  shares: z.string().nullable().optional(),
  share_price: z.string().nullable().optional(),
});

/** SEC-Form-4-Transaktionscodes (Auswahl). Nur „P“ ist ein Kauf am offenen Markt. */
export const FORM4_CODES: Record<string, { label: string; kind: "KAUF" | "VERKAUF" | "ZUTEILUNG" | "SONSTIGE" }> = {
  P: { label: "Kauf am offenen Markt", kind: "KAUF" },
  S: { label: "Verkauf am offenen Markt", kind: "VERKAUF" },
  A: { label: "Zuteilung/Gewährung (z. B. RSU)", kind: "ZUTEILUNG" },
  M: { label: "Ausübung/Umwandlung derivativer Rechte", kind: "SONSTIGE" },
  F: { label: "Einbehalt für Steuern/Ausübungspreis", kind: "SONSTIGE" },
  G: { label: "Schenkung", kind: "SONSTIGE" },
  D: { label: "Rückgabe an den Emittenten", kind: "SONSTIGE" },
  C: { label: "Umwandlung", kind: "SONSTIGE" },
  X: { label: "Ausübung (im Geld)", kind: "SONSTIGE" },
};

export interface InsiderTx {
  date: string;
  insider: string;
  role: string | null;
  security: string | null;
  code: string;
  codeLabel: string;
  kind: "KAUF" | "VERKAUF" | "ZUTEILUNG" | "SONSTIGE";
  shares: number | null;
  price: number | null;
  dedupeKey: string;
}

export function parseInsiderTransactions(json: unknown): InsiderTx[] {
  const err = detectAvError(json);
  if (err) throw err;
  const arr = (json as { data?: unknown[] }).data;
  if (!Array.isArray(arr)) throw new ProviderError("Feld 'data' fehlt", "FORMAT");
  const seen = new Map<string, number>();
  return arr.flatMap((r) => {
    const p = InsiderSchema.safeParse(r);
    if (!p.success || !/^\d{4}-\d{2}-\d{2}$/.test(p.data.transaction_date)) return [];
    const x = p.data;
    const code = x.acquisition_or_disposal.trim().toUpperCase();
    const c = FORM4_CODES[code] ?? { label: `Code ${code} (unbekannt)`, kind: "SONSTIGE" as const };
    const base = [x.ticker, x.transaction_date, x.executive, code, x.security_type ?? "", x.shares ?? "", x.share_price ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1; // identische Zeilen sind mehrere Teilausführungen – nicht verwerfen
    seen.set(base, n);
    const price = num(x.share_price);
    return [{ date: x.transaction_date, insider: x.executive, role: x.executive_title ?? null, security: x.security_type ?? null, code, codeLabel: c.label, kind: c.kind, shares: num(x.shares), price: price === 0 && c.kind !== "KAUF" && c.kind !== "VERKAUF" ? null : price, dedupeKey: `av|${base}|${n}` }];
  });
}

// ---------- Institutionelle Beteiligungen (INSTITUTIONAL_HOLDINGS, 13F-basiert) ----------

const InstSchema = z.object({
  symbol: z.string(),
  total_institutional_holders: z.string().nullable().optional(),
  holders_with_increased_holdings: z.string().nullable().optional(),
  holders_with_decreased_holdings: z.string().nullable().optional(),
  shares_with_increased_holdings: z.string().nullable().optional(),
  shares_with_decreased_holdings: z.string().nullable().optional(),
  total_institutional_ownership_percentage: z.string().nullable().optional(),
  holdings: z.array(z.object({ holder_name: z.string(), shares_held: z.string().nullable(), shares_changed: z.string().nullable().optional(), change_type: z.string().nullable().optional(), last_reported: z.string().nullable().optional() })).default([]),
  holdings_truncated: z.boolean().optional(),
});

export function parseInstitutionalHoldings(json: unknown) {
  const err = detectAvError(json);
  if (err) throw err;
  const p = InstSchema.safeParse(json);
  if (!p.success) throw new ProviderError("Institutionelle Beteiligungen: unerwartetes Format", "FORMAT");
  const x = p.data;
  const periods = [...new Set(x.holdings.map((h) => h.last_reported).filter((d): d is string => !!d))].sort();
  const incShares = num(x.shares_with_increased_holdings), decShares = num(x.shares_with_decreased_holdings);
  return {
    symbol: x.symbol,
    holders: num(x.total_institutional_holders),
    increased: num(x.holders_with_increased_holdings),
    decreased: num(x.holders_with_decreased_holdings),
    netSharesChange: incShares != null && decShares != null ? incShares - decShares : null,
    ownershipPct: num((x.total_institutional_ownership_percentage ?? "").replace("%", "")),
    holdings: x.holdings.map((h) => ({ holder: h.holder_name, shares: num(h.shares_held), change: num(h.shares_changed), changeType: h.change_type ?? null, reportPeriod: h.last_reported ?? null })),
    reportPeriods: periods,
    mixedPeriods: periods.length > 1,
    truncated: x.holdings_truncated ?? false,
  };
}
