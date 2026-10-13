/**
 * Adapter für offizielle bzw. frei dokumentierte Quellen: FRED, EZB, SEC EDGAR, Kalshi (CoinGecko: ./coingecko.ts).
 * Alle Adapter sind nach der jeweiligen Dokumentation gebaut; Live-Abrufe waren in der
 * Entwicklungsumgebung gesperrt (Status „UNGEPRÜFT“ im Quellenregister).
 */
import { z } from "zod";
import { fetchWithRetry, ProviderError, RateLimiter } from "./http";
import type { DailyBar, MacroSeriesData } from "./types";

const num = (s: unknown): number | null => {
  if (s === undefined || s === null || s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ============================== FRED ==============================

export const FRED_SERIES: Record<string, { id: string; name: string; unit: string; originalSource: string; frequency: string }> = {
  US10Y: { id: "DGS10", name: "Rendite 10-jähriger US-Staatsanleihen (Constant Maturity)", unit: "%", originalSource: "Federal Reserve H.15", frequency: "daily" },
  EFFR: { id: "DFF", name: "Effective Federal Funds Rate", unit: "%", originalSource: "Federal Reserve H.15 / New York Fed", frequency: "daily" },
  REAL10Y: { id: "DFII10", name: "Realzins 10 Jahre (TIPS, Constant Maturity)", unit: "%", originalSource: "Federal Reserve H.15", frequency: "daily" },
  BREAKEVEN10Y: { id: "T10YIE", name: "Breakeven-Inflation 10 Jahre", unit: "%", originalSource: "FRED (berechnet)", frequency: "daily" },
  WTI: { id: "DCOILWTICO", name: "WTI Rohöl Spot", unit: "USD je Barrel", originalSource: "U.S. EIA", frequency: "daily" },
  BRENT: { id: "DCOILBRENTEU", name: "Brent Rohöl Spot", unit: "USD je Barrel", originalSource: "U.S. EIA", frequency: "daily" },
  USD_PER_EUR: { id: "DEXUSEU", name: "USD je EUR (Noon Buying Rate)", unit: "USD je EUR", originalSource: "Federal Reserve H.10", frequency: "daily" },
  UMCSENT: { id: "UMCSENT", name: "Konsumentenstimmung University of Michigan", unit: "Index 1966:Q1=100", originalSource: "University of Michigan", frequency: "monthly" },
  DEBT_GDP: { id: "GFDEGDQ188S", name: "US-Staatsverschuldung in % des BIP", unit: "%", originalSource: "U.S. Treasury / OMB", frequency: "quarterly" },
  NCBE_EQUITY: { id: "NCBEILQ027S", name: "Marktwert Aktien nichtfinanzieller Unternehmen (Z.1)", unit: "Mio. USD", originalSource: "Federal Reserve Z.1", frequency: "quarterly" },
  GDP: { id: "GDP", name: "Bruttoinlandsprodukt USA (nominal, annualisiert)", unit: "Mrd. USD", originalSource: "U.S. BEA", frequency: "quarterly" },
};

const FredSchema = z.object({ observations: z.array(z.object({ date: z.string(), value: z.string() })) });

export function parseFredObservations(json: unknown, key: string): MacroSeriesData {
  const meta = FRED_SERIES[key];
  if (!meta) throw new ProviderError(`Unbekannte FRED-Reihe ${key}`, "FORMAT");
  const o = json as { error_message?: string };
  if (o && typeof o === "object" && o.error_message) throw new ProviderError(`FRED: ${o.error_message}`, "HTTP");
  const p = FredSchema.safeParse(json);
  if (!p.success) throw new ProviderError("FRED-Antwort hat unerwartetes Format", "FORMAT");
  return { key, name: meta.name, unit: meta.unit, points: p.data.observations.map((x) => ({ date: x.date, value: num(x.value) })) };
}

export async function fredSeries(key: string, apiKey: string, observationStart?: string, fetchImpl?: typeof fetch) {
  if (!apiKey) throw new ProviderError("FRED_API_KEY fehlt", "ZUGANG_FEHLT");
  const meta = FRED_SERIES[key];
  if (!meta) throw new ProviderError(`Unbekannte FRED-Reihe ${key}`, "FORMAT");
  const qs = new URLSearchParams({ series_id: meta.id, api_key: apiKey, file_type: "json" });
  if (observationStart) qs.set("observation_start", observationStart);
  const res = await fetchWithRetry(`https://api.stlouisfed.org/fred/series/observations?${qs}`, { fetchImpl });
  return parseFredObservations(await res.json(), key);
}

/**
 * Buffett-Indikator-Näherung: Marktwert der Aktien nichtfinanzieller Unternehmen (Z.1, Mio. USD)
 * ÷ nominales BIP (Mrd. USD) × 100. Nur Quartale, für die beide Werte vorliegen.
 * Hinweis: Weicht von der Variante „Wilshire 5000 / BIP“ ab; Kontextindikator, kein Timing-Signal.
 */
export function buffettIndicator(equity: MacroSeriesData, gdp: MacroSeriesData) {
  const g = new Map(gdp.points.filter((p) => p.value != null).map((p) => [p.date, p.value!]));
  return equity.points
    .filter((p) => p.value != null && g.has(p.date))
    .map((p) => ({ date: p.date, value: (p.value! / 1000 / g.get(p.date)!) * 100 }));
}

// ============================== EZB ==============================

/** SDMX-CSV der EZB (z. B. EXR.D.USD.EUR.SP00.A): Spalten TIME_PERIOD und OBS_VALUE. */
export function parseEcbCsv(csv: string, key = "EURUSD"): MacroSeriesData {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((h) => h.replace(/"/g, ""));
  const ti = header.indexOf("TIME_PERIOD");
  const vi = header.indexOf("OBS_VALUE");
  if (ti < 0 || vi < 0) throw new ProviderError("EZB-CSV ohne TIME_PERIOD/OBS_VALUE", "FORMAT");
  const points = lines.filter(Boolean).map((l) => {
    const c = l.split(",").map((x) => x.replace(/"/g, ""));
    return { date: c[ti]!, value: num(c[vi]) };
  }).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { key, name: "EUR/USD EZB-Referenzkurs", unit: "USD je EUR", points };
}

export async function ecbEurUsd(startPeriod?: string, fetchImpl?: typeof fetch) {
  const qs = new URLSearchParams({ format: "csvdata" });
  if (startPeriod) qs.set("startPeriod", startPeriod);
  const res = await fetchWithRetry(`https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?${qs}`, { fetchImpl });
  return parseEcbCsv(await res.text());
}

// ============================== SEC EDGAR ==============================

const CompanyTickersSchema = z.record(z.string(), z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }));

export function parseCompanyTickers(json: unknown): Map<string, { cik: string; title: string }> {
  const p = CompanyTickersSchema.safeParse(json);
  if (!p.success) throw new ProviderError("company_tickers.json hat unerwartetes Format", "FORMAT");
  const m = new Map<string, { cik: string; title: string }>();
  for (const v of Object.values(p.data)) m.set(v.ticker.toUpperCase(), { cik: String(v.cik_str).padStart(10, "0"), title: v.title });
  return m;
}

const FactSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string().optional(),
  fy: z.number().nullable().optional(),
  fp: z.string().nullable().optional(),
  form: z.string().optional(),
  filed: z.string(),
  frame: z.string().optional(),
});
const CompanyFactsSchema = z.object({
  cik: z.union([z.number(), z.string()]),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), z.object({ label: z.string().nullable().optional(), units: z.record(z.string(), z.array(FactSchema)) }))),
});

/** Zuordnung interner Kennzahlen zu US-GAAP-Tags (erster vorhandener Tag gewinnt). */
export const GAAP_TAGS: Record<string, { tags: string[]; unit: string; flow: boolean }> = {
  REVENUE: { tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "USD", flow: true },
  NET_INCOME: { tags: ["NetIncomeLoss"], unit: "USD", flow: true },
  OPERATING_CASH_FLOW: { tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD", flow: true },
  CAPEX: { tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], unit: "USD", flow: true },
  SBC: { tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"], unit: "USD", flow: true },
  EPS_DILUTED: { tags: ["EarningsPerShareDiluted"], unit: "USD/shares", flow: true },
  SHARES_DILUTED: { tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares", flow: true },
  BUYBACKS: { tags: ["PaymentsForRepurchaseOfCommonStock"], unit: "USD", flow: true },
  CASH: { tags: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD", flow: false },
  LONG_TERM_DEBT: { tags: ["LongTermDebt", "LongTermDebtNoncurrent"], unit: "USD", flow: false },
  EQUITY: { tags: ["StockholdersEquity"], unit: "USD", flow: false },
};

export interface SecFact {
  metric: string;
  periodEnd: string;
  periodType: "FY" | "Q" | "POINT";
  fiscalYear: number | null;
  value: number;
  unit: string;
  filedAt: string;
  accession: string | null;
  form: string | null;
  tag: string;
}

/**
 * Extrahiert Jahreswerte (10-K, Dauer ≈ 1 Jahr) und Stichtagswerte. Für jeden Zeitraum wird die
 * ZUERST eingereichte Angabe behalten (Point-in-Time, vermeidet Look-ahead durch spätere Korrekturen);
 * spätere Korrekturen werden separat gezählt.
 */
export function parseCompanyFacts(json: unknown): { entityName: string; cik: string; facts: SecFact[]; restatements: number } {
  const p = CompanyFactsSchema.safeParse(json);
  if (!p.success) throw new ProviderError("companyfacts hat unerwartetes Format", "FORMAT");
  const gaap = p.data.facts["us-gaap"] ?? {};
  const out: SecFact[] = [];
  let restatements = 0;
  for (const [metric, def] of Object.entries(GAAP_TAGS)) {
    const tag = def.tags.find((t) => gaap[t]);
    if (!tag) continue;
    const units = gaap[tag]!.units;
    const series = units[def.unit] ?? Object.values(units)[0] ?? [];
    const byPeriod = new Map<string, z.infer<typeof FactSchema>>();
    for (const f of series) {
      if (!f.form || !/^10-K|^10-Q|^20-F|^40-F/.test(f.form)) continue;
      let periodType: SecFact["periodType"];
      if (def.flow) {
        if (!f.start) continue;
        const days = (Date.parse(f.end) - Date.parse(f.start)) / 86400000;
        if (days > 350 && days < 380 && /^10-K|^20-F|^40-F/.test(f.form)) periodType = "FY";
        else if (days > 80 && days < 100) periodType = "Q";
        else continue;
      } else periodType = "POINT";
      const k = `${periodType}|${f.start ?? ""}|${f.end}`;
      const prev = byPeriod.get(k);
      if (!prev) byPeriod.set(k, f);
      else {
        if (prev.val !== f.val) restatements++;
        if (f.filed < prev.filed) byPeriod.set(k, f);
      }
    }
    for (const [k, f] of byPeriod) {
      out.push({
        metric,
        periodEnd: f.end,
        periodType: k.split("|")[0] as SecFact["periodType"],
        fiscalYear: f.fy ?? null,
        value: f.val,
        unit: def.unit,
        filedAt: f.filed,
        accession: f.accn ?? null,
        form: f.form ?? null,
        tag,
      });
    }
  }
  return { entityName: p.data.entityName, cik: String(p.data.cik).padStart(10, "0"), facts: out, restatements };
}

/** SEC verlangt einen aussagekräftigen User-Agent mit Kontakt. */
export function secHeaders(userAgent: string | undefined): Record<string, string> {
  if (!userAgent || !/@|https?:\/\//.test(userAgent)) throw new ProviderError("SEC_USER_AGENT fehlt oder enthält keine Kontaktangabe (Name + E-Mail)", "ZUGANG_FEHLT");
  return { "User-Agent": userAgent, Accept: "application/json" };
}

export const secLimiter = new RateLimiter(150); // ≤ 10/s laut SEC, konservativ ~6/s

export async function secCompanyFacts(cik: string, userAgent: string | undefined, fetchImpl?: typeof fetch) {
  await secLimiter.acquire();
  const res = await fetchWithRetry(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`, { headers: secHeaders(userAgent), fetchImpl });
  return parseCompanyFacts(await res.json());
}

export async function secTickerMap(userAgent: string | undefined, fetchImpl?: typeof fetch) {
  await secLimiter.acquire();
  const res = await fetchWithRetry("https://www.sec.gov/files/company_tickers.json", { headers: secHeaders(userAgent), fetchImpl });
  return parseCompanyTickers(await res.json());
}

// ============================== Kalshi ==============================

const KalshiMarketsSchema = z.object({
  markets: z.array(z.object({
    ticker: z.string(),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    yes_bid: z.number().nullable().optional(),
    yes_ask: z.number().nullable().optional(),
    last_price: z.number().nullable().optional(),
    volume: z.number().nullable().optional(),
    close_time: z.string().nullable().optional(),
    status: z.string().optional(),
  })),
});

/**
 * Marktimplizierter Preis eines Ja-Kontrakts (Cent) als grobe Wahrscheinlichkeit.
 * Mittelwert aus Geld/Brief, sonst letzter Preis. KEINE Prognose.
 */
export function parseKalshiMarkets(json: unknown) {
  const p = KalshiMarketsSchema.safeParse(json);
  if (!p.success) throw new ProviderError("Kalshi-Antwort hat unerwartetes Format", "FORMAT");
  return p.data.markets.map((m) => {
    const mid = m.yes_bid != null && m.yes_ask != null && m.yes_ask > 0 ? (m.yes_bid + m.yes_ask) / 2 : null;
    const priceCents = mid ?? m.last_price ?? null;
    return { ticker: m.ticker, title: m.title ?? m.ticker, subtitle: m.subtitle ?? null, impliedPct: priceCents, basis: mid != null ? "Mitte Geld/Brief" : m.last_price != null ? "letzter Preis" : "keine Preise", volume: m.volume ?? null, closeTime: m.close_time ?? null, status: m.status ?? null };
  });
}

export async function kalshiFedMarkets(seriesTicker = "KXFED", fetchImpl?: typeof fetch) {
  const res = await fetchWithRetry(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=200`, { fetchImpl });
  return parseKalshiMarkets(await res.json());
}

// CoinGecko: siehe ./coingecko.ts
