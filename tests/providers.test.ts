import { describe, expect, it } from "vitest";
import { parseTimeSeries, parseEconomic, parseGoldSilver, parseFxDaily, parseEarningsCsv, parseCongressTrades, detectAvError, parseGlobalQuote } from "@/lib/providers/alphavantage";
import { parseFredObservations, parseEcbCsv, parseCompanyFacts, parseCompanyTickers, parseKalshiMarkets, parseCoinGeckoChart, buffettIndicator, secHeaders } from "@/lib/providers/official";
import { loadSnapshot } from "./helpers";

describe("Alpha Vantage – echte Antworten (Snapshot 11.10.2026)", () => {
  it("Wochenkurse SPY: aufsteigend sortiert, Rohkurse, Datenstand", () => {
    const s = parseTimeSeries(loadSnapshot("TIME_SERIES_WEEKLY_SPY.json"), "WEEK", "USD", "2026-10-11");
    expect(s.bars.length).toBe(1405);
    expect(s.bars.at(-1)).toMatchObject({ date: "2026-10-09", close: 778.57 });
    expect(s.bars[0]!.date < s.bars[1]!.date).toBe(true);
    expect(s.adjusted).toBe(false);
    expect(s.lastRefreshed).toBe("2026-10-09");
    expect(s.partialLastBar).toBe(false); // Sonntag: Woche abgeschlossen
  });
  it("Krypto-Tageskurse: laufender UTC-Tag wird als unvollständig markiert", () => {
    const s = parseTimeSeries(loadSnapshot("DIGITAL_CURRENCY_DAILY_BTC_EUR.json"), "DAY", "EUR", "2026-10-11");
    expect(s.bars.length).toBe(350);
    expect(s.bars.at(-1)!.date).toBe("2026-10-11");
    expect(s.partialLastBar).toBe(true);
    expect(s.timeZone).toBe("UTC");
  });
  it("10J-Rendite: '.' wird als fehlender Wert (null) übernommen, nicht geschätzt", () => {
    const m = parseEconomic(loadSnapshot("TREASURY_YIELD_10Y_DAILY.json"), "US10Y");
    expect(m.unit).toBe("percent");
    expect(m.points.at(-1)).toEqual({ date: "2026-10-08", value: 5.22 });
    const holiday = m.points.find((p) => p.date === "2026-09-07")!; // Labor Day
    expect(holiday.value).toBeNull();
    expect(m.points.filter((p) => p.value === null).length).toBe(720);
  });
  it("Fed Funds, WTI, Gold", () => {
    expect(parseEconomic(loadSnapshot("FEDERAL_FUNDS_RATE_DAILY.json"), "EFFR").points.at(-1)).toEqual({ date: "2026-10-08", value: 3.88 });
    expect(parseEconomic(loadSnapshot("WTI_DAILY.json"), "WTI").points.at(-1)).toEqual({ date: "2026-10-06", value: 96.24 });
    const g = parseGoldSilver(loadSnapshot("GOLD_DAILY.json"), "GOLD_USD");
    expect(g.points.at(-1)!.date).toBe("2026-10-10");
    expect(g.points.at(-1)!.value).toBeCloseTo(4194.3493725253, 8);
  });
  it("FX_DAILY (echtes Format) → EUR/USD", () => {
    const json = { "Meta Data": { "1. Information": "Forex Daily Prices (open, high, low, close)", "2. From Symbol": "EUR", "3. To Symbol": "USD", "4. Output Size": "Compact", "5. Last Refreshed": "2026-10-09", "6. Time Zone": "UTC" }, "Time Series FX (Daily)": { "2026-10-09": { "1. open": "1.12110", "2. high": "1.12430", "3. low": "1.11870", "4. close": "1.12010" }, "2026-10-08": { "1. open": "1.11940", "2. high": "1.12260", "3. low": "1.11710", "4. close": "1.12090" } } };
    const m = parseFxDaily(json, "EURUSD");
    expect(m.unit).toBe("USD je EUR");
    expect(m.points).toEqual([{ date: "2026-10-08", value: 1.1209 }, { date: "2026-10-09", value: 1.1201 }]);
  });
  it("Earnings-Kalender (echte CSV-Antwort)", () => {
    const e = parseEarningsCsv("symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\r\nAAPL,APPLE INCORPORATED,2026-11-02,2026-09-30,1.98,USD,post-market\r\n");
    expect(e).toEqual([{ symbol: "AAPL", reportDate: "2026-11-02", fiscalPeriodEnd: "2026-09-30", epsEstimate: 1.98, currency: "USD", timeOfDay: "post-market" }]);
  });
  it("Fehler- und Limitantworten werden erkannt (echte Meldungstexte)", () => {
    expect(detectAvError({ error: { type: "rate_limit", message: "The outputsize=full parameter value is a premium feature for the TIME_SERIES_DAILY endpoint." } })!.kind).toBe("PREMIUM");
    expect(detectAvError({ Information: "Thank you for using Alpha Vantage! Please consider spreading out your free API requests more sparingly (1 request per second)." })!.kind).toBe("RATE_LIMIT");
    expect(detectAvError({ "Error Message": "Invalid API call." })!.kind).toBe("HTTP");
    expect(() => parseTimeSeries({ Note: "rate limit" }, "DAY", "USD")).toThrow();
    expect(() => parseTimeSeries({ "Meta Data": {} }, "DAY", "USD")).toThrow(/Zeitreihe fehlt/);
  });
  it("ungültige Zeilen werden verworfen statt geschätzt", () => {
    const s = parseTimeSeries({ "Meta Data": {}, "Time Series (Daily)": { "2026-10-09": { "4. close": "abc" }, "2026-10-08": { "4. close": "10" }, "kaputt": { "4. close": "5" } } }, "DAY", "USD");
    expect(s.bars).toEqual([{ date: "2026-10-08", open: null, high: null, low: null, close: 10, volume: null }]);
  });
  it("Global Quote ohne Geld-/Briefkurs", () => {
    const q = parseGlobalQuote({ "Global Quote": { "01. symbol": "IBM", "05. price": "250.10", "07. latest trading day": "2026-10-09" } }, "USD");
    expect(q.bid).toBeNull();
    expect(q.last).toBe(250.1);
    expect(() => parseGlobalQuote({ "Global Quote": {} }, "USD")).toThrow();
  });
  it("Kongress-Transaktionen (echte NVDA-Antwort) werden validiert", () => {
    const r = parseCongressTrades(loadSnapshot("CONGRESS_TRADES_NVDA.json"));
    expect(r.trades.length).toBe(436);
    expect(r.invalid).toBe(0);
  });
});

// Die folgenden Beispiele folgen den dokumentierten Formaten (keine echten Antworten – Hosts in der Entwicklungsumgebung gesperrt).
describe("Offizielle Quellen – dokumentierte Formate", () => {
  it("FRED: '.' = fehlend; Fehlermeldung wird erkannt", () => {
    const m = parseFredObservations({ observations: [{ date: "2026-10-07", value: "4.10" }, { date: "2026-10-08", value: "." }] }, "US10Y");
    expect(m.points).toEqual([{ date: "2026-10-07", value: 4.1 }, { date: "2026-10-08", value: null }]);
    expect(() => parseFredObservations({ error_code: 400, error_message: "Bad Request. The value for variable api_key is not registered." }, "US10Y")).toThrow(/FRED/);
  });
  it("Buffett-Indikator nur für Quartale mit beiden Werten (Einheiten Mio./Mrd.)", () => {
    const eq = { key: "a", name: "", unit: "", points: [{ date: "2026-01-01", value: 60_000_000 }, { date: "2026-04-01", value: 61_000_000 }] };
    const gdp = { key: "b", name: "", unit: "", points: [{ date: "2026-01-01", value: 30_000 }] };
    expect(buffettIndicator(eq, gdp)).toEqual([{ date: "2026-01-01", value: 200 }]);
  });
  it("EZB SDMX-CSV", () => {
    const m = parseEcbCsv("KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-09,1.1205\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-10-08,1.1210\n");
    expect(m.points).toEqual([{ date: "2026-10-08", value: 1.121 }, { date: "2026-10-09", value: 1.1205 }]);
    expect(() => parseEcbCsv("A,B\n1,2")).toThrow();
  });
  it("SEC: Jahreswerte, Einreichungsdatum, erste Fassung gewinnt (Point-in-Time)", () => {
    const facts = { cik: 320193, entityName: "Apple Inc.", facts: { "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: { label: "Revenue", units: { USD: [
        { start: "2024-09-29", end: "2025-09-27", val: 400, fy: 2025, fp: "FY", form: "10-K", filed: "2025-10-31" },
        { start: "2024-09-29", end: "2025-09-27", val: 401, fy: 2026, fp: "FY", form: "10-K", filed: "2026-10-30" },
        { start: "2025-06-29", end: "2025-09-27", val: 100, fy: 2025, fp: "Q4", form: "10-K", filed: "2025-10-31" },
        { start: "2024-09-29", end: "2025-09-27", val: 399, form: "8-K", filed: "2025-10-30" },
      ] } },
      CashAndCashEquivalentsAtCarryingValue: { label: "Cash", units: { USD: [{ end: "2025-09-27", val: 30, form: "10-K", filed: "2025-10-31" }] } },
    } } };
    const r = parseCompanyFacts(facts);
    const rev = r.facts.filter((f) => f.metric === "REVENUE");
    expect(rev.find((f) => f.periodType === "FY")).toMatchObject({ value: 400, filedAt: "2025-10-31" });
    expect(rev.find((f) => f.periodType === "Q")!.value).toBe(100);
    expect(r.restatements).toBe(1);
    expect(r.facts.find((f) => f.metric === "CASH")!.periodType).toBe("POINT");
    expect(r.cik).toBe("0000320193");
  });
  it("SEC: Ticker-Zuordnung und Pflicht-User-Agent", () => {
    expect(parseCompanyTickers({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }).get("AAPL")!.cik).toBe("0000320193");
    expect(() => secHeaders(undefined)).toThrow(/SEC_USER_AGENT/);
    expect(() => secHeaders("Handelsbuch")).toThrow();
    expect(secHeaders("Handelsbuch privat kontakt@example.org")["User-Agent"]).toContain("example.org");
  });
  it("Kalshi: Mitte aus Geld/Brief, sonst letzter Preis", () => {
    const r = parseKalshiMarkets({ markets: [{ ticker: "A", yes_bid: 60, yes_ask: 64 }, { ticker: "B", last_price: 10 }, { ticker: "C" }] });
    expect(r.map((x) => [x.impliedPct, x.basis])).toEqual([[62, "Mitte Geld/Brief"], [10, "letzter Preis"], [null, "keine Preise"]]);
  });
  it("CoinGecko: Tageswerte, laufender Tag markiert", () => {
    const d = (s: string) => Date.parse(s);
    const r = parseCoinGeckoChart({ prices: [[d("2026-10-10T00:00:00Z"), 73000], [d("2026-10-11T00:00:00Z"), 74000], [d("2026-10-11T12:00:00Z"), 74100]], total_volumes: [[d("2026-10-10T00:00:00Z"), 5]], market_caps: [[d("2026-10-11T12:00:00Z"), 1.4e12]] }, "2026-10-11");
    expect(r.bars.map((b) => [b.date, b.close])).toEqual([["2026-10-10", 73000], ["2026-10-11", 74100]]);
    expect(r.partialLast).toBe(true);
    expect(r.marketCap).toBe(1.4e12);
  });
});

import { parseRss, htmlToText } from "@/lib/social/truthsocial";
describe("Truth Social – optionaler RSS-Import (synthetisches RSS 2.0)", () => {
  it("übernimmt Text unverändert (nur HTML entfernt), Zeitstempel in UTC, chronologisch absteigend", async () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title><link>https://truthsocial.com/@realDonaldTrump/1</link><guid>1</guid><pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate><description>&lt;p&gt;Erster &amp;amp; Text&lt;/p&gt;</description></item><item><link>https://truthsocial.com/@realDonaldTrump/2</link><guid>2</guid><pubDate>Sat, 10 Oct 2026 08:30:00 -0400</pubDate><description>Zweiter</description></item><item><link></link><pubDate>kaputt</pubDate></item></channel></rss>`;
    const r = await parseRss(xml);
    expect(r.map((p) => p.id)).toEqual(["2", "1"]);
    expect(r[0]!.createdAt).toBe("2026-10-10T12:30:00.000Z");
    expect(r[1]!.text).toBe("Erster & Text");
  });
  it("DOCTYPE-Entitäten werden entfernt", async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e "BOOM">]><rss><channel><item><link>u</link><guid>g</guid><pubDate>Fri, 09 Oct 2026 14:00:00 GMT</pubDate><description>&e;</description></item></channel></rss>`;
    const r = await parseRss(xml);
    expect(r[0]!.text).not.toContain("BOOM");
  });
  it("HTML → Text mit Zeilenumbrüchen", () => {
    expect(htmlToText("a<br>b<p>c</p>")).toBe("a\nbc");
  });
});
