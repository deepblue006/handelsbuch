/**
 * Marktlage & Finanzwiesel-Kennzahlen: Indizes (ETF-Proxys), Marktbreite, Zinsen, Öl, Gold, Währung, Bewertungskontext.
 */
import type { CryptoGlobal } from "../providers/coingecko";
import { cache } from "react";
import { prisma } from "../db";
import { sma, weinsteinStage, distancePct, detectPossibleSplits } from "../calc/indicators";
import { breadthAt, drawdownFromHigh, breadthSeries } from "../calc/breadth";
import { getBars, splitSafe, macro, lastValid, valueAtOrBefore, type MacroResult } from "./data";
import { upcomingFomc } from "../fomc";
import { sectorRotation, seasonality } from "../calc/sectors";
import { getRuleConfig, getGeneral, todayIso } from "../settings";

export const SECTOR_ETF_TAG = "SPDR-Sektor-ETF";
export const SECTOR_ETFS: [string, string][] = [
  ["XLK", "Technologie"], ["XLF", "Finanzen"], ["XLV", "Gesundheit"], ["XLE", "Energie"], ["XLI", "Industrie"], ["XLY", "Zyklischer Konsum"],
  ["XLP", "Basiskonsum"], ["XLU", "Versorger"], ["XLB", "Grundstoffe"], ["XLRE", "Immobilien"], ["XLC", "Kommunikation"],
];

export const INDEX_PROXIES = [
  { symbol: "SPY", label: "S&P 500", proxyNote: "SPDR S&P 500 ETF (SPY) als Proxy – kein Indexstand" },
  { symbol: "QQQ", label: "Nasdaq-100", proxyNote: "Invesco QQQ als Proxy für den Nasdaq-100 (nicht Nasdaq Composite)" },
  { symbol: "IWM", label: "Russell 2000", proxyNote: "iShares Russell 2000 ETF (IWM) als Proxy" },
];

export interface IndexView {
  symbol: string;
  label: string;
  proxyNote: string;
  available: boolean;
  provider: string | null;
  isSnapshot: boolean;
  isDemo: boolean;
  fetchedAt: Date | null;
  lastDate: string | null;
  last: number | null;
  currency: string | null;
  sma200d: number | null;
  dailyBars: number;
  ma40w: number | null; // Näherung der 200-Tage-Linie aus Wochenkursen (gekennzeichnet)
  ma30w: number | null;
  stage: ReturnType<typeof weinsteinStage> | null;
  drawdownPct: number | null;
  highDate: string | null;
  splitWarnings: { date: string; factor: number }[];
  weekly: { date: string; close: number; ma30: number | null; ma40: number | null }[];
}

export const indexViews = cache(async (): Promise<IndexView[]> => {
  const out: IndexView[] = [];
  for (const p of INDEX_PROXIES) {
    const inst = await prisma.instrument.findUnique({ where: { symbol: p.symbol } });
    if (!inst) { out.push({ ...p, available: false, provider: null, isSnapshot: false, isDemo: false, fetchedAt: null, lastDate: null, last: null, currency: null, sma200d: null, dailyBars: 0, ma40w: null, ma30w: null, stage: null, drawdownPct: null, highDate: null, splitWarnings: [], weekly: [] }); continue; }
    const [d, w] = await Promise.all([getBars(inst.id, "DAY"), getBars(inst.id, "WEEK")]);
    const wc = w.bars.map((b) => b.close);
    const ma30 = sma(wc, 30);
    const ma40 = sma(wc, 40);
    const dd = drawdownFromHigh((d.bars.length && w.bars.length && d.bars.at(-1)!.date > w.bars.at(-1)!.date ? [...w.bars, d.bars.at(-1)!] : w.bars).map((b) => ({ date: b.date, close: b.close })));
    const dc = d.bars.map((b) => b.close);
    const s200 = dc.length >= 200 ? sma(dc, 200).at(-1)! : null;
    const latest = [d.bars.at(-1), w.bars.at(-1)].filter(Boolean).sort((a, b) => (a!.date < b!.date ? 1 : -1))[0];
    out.push({
      ...p, available: !!latest, provider: w.provider ?? d.provider, isSnapshot: w.isSnapshot || d.isSnapshot, isDemo: w.isDemo || d.isDemo,
      fetchedAt: w.fetchedAt ?? d.fetchedAt, lastDate: latest?.date ?? null, last: latest?.close ?? null, currency: w.currency ?? d.currency,
      sma200d: s200, dailyBars: dc.length, ma40w: ma40.at(-1) ?? null, ma30w: ma30.at(-1) ?? null,
      stage: wc.length ? weinsteinStage(wc) : null, drawdownPct: dd?.drawdownPct ?? null, highDate: dd?.highDate ?? null,
      splitWarnings: splitSafe(w) ? [] : detectPossibleSplits(w.bars.slice(-60)),
      weekly: w.bars.slice(-156).map((b, i, arr) => { const idx = w.bars.length - arr.length + i; return { date: b.date, close: b.close, ma30: ma30[idx] ?? null, ma40: ma40[idx] ?? null }; }),
    });
  }
  return out;
});

export const breadthView = cache(async (asOf: string) => {
  const universe = await prisma.instrument.findMany({ where: { inBreadthUniverse: true }, orderBy: { symbol: "asc" } });
  const inputs = [];
  for (const u of universe) {
    const d = await getBars(u.id, "DAY");
    inputs.push({ symbol: u.symbol, bars: d.bars.map((b) => ({ date: b.date, close: b.close })) });
  }
  const current = breadthAt(inputs, asOf);
  const dates: string[] = [];
  const t = new Date(asOf + "T00:00:00Z");
  for (let i = 25; i >= 0; i--) { const x = new Date(t); x.setUTCDate(x.getUTCDate() - i * 7); dates.push(x.toISOString().slice(0, 10)); }
  const external = await macro(["BREADTH_EXTERNAL"]);
  return { current, history: breadthSeries(inputs, dates), external, representative: current.evaluated >= 20 };
});

export interface MacroCard {
  id: string;
  title: string;
  series: MacroResult | null;
  last: { date: string; value: number } | null;
  changes: { label: string; delta: number | null }[];
  unitLabel: string;
  note: string;
}

function changes(points: { date: string; value: number | null }[], lastDate: string, lastValue: number) {
  const back = (days: number) => { const d = new Date(lastDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  return [["1 W", 7], ["1 M", 30], ["3 M", 91], ["1 J", 365]].map(([label, days]) => {
    const v = valueAtOrBefore(points, back(days as number));
    return { label: label as string, delta: v ? lastValue - v.value : null };
  });
}

export async function macroCards(): Promise<MacroCard[]> {
  const since = "2015-01-01";
  const defs: { id: string; title: string; keys: string[]; unitLabel: string; note: string }[] = [
    { id: "us10y", title: "Rendite 10J US-Staatsanleihen", keys: ["FRED_US10Y", "US10Y"], unitLabel: "%", note: "Wichtiger Makrofaktor für Wachstumsaktien und Emerging Markets (Diskontierung künftiger Gewinne). Beobachteter Zusammenhang, kein Automatismus." },
    { id: "effr", title: "Effective Federal Funds Rate", keys: ["FRED_EFFR", "EFFR"], unitLabel: "%", note: "Effektiver US-Leitzins (H.15)." },
    { id: "real", title: "Realzins 10J (TIPS)", keys: ["FRED_REAL10Y"], unitLabel: "%", note: "Realzinsen gelten als wichtiger Einflussfaktor für Gold." },
    { id: "eurusd", title: "EUR/USD", keys: ["ECB_EURUSD", "EURUSD", "FRED_USD_PER_EUR"], unitLabel: "USD je EUR", note: "Ein steigender Euro mindert die in Euro gerechnete Rendite von US-Aktien." },
    { id: "wti", title: "WTI Rohöl", keys: ["FRED_WTI", "WTI"], unitLabel: "USD/Barrel", note: "Ölpreise können über Inflationserwartungen und Zinsen auf Aktien und Emerging Markets wirken." },
    { id: "brent", title: "Brent Rohöl", keys: ["FRED_BRENT", "BRENT"], unitLabel: "USD/Barrel", note: "" },
    { id: "gold", title: "Gold", keys: ["GOLD_USD"], unitLabel: "USD/Unze", note: "Möglicher Diversifikationsbaustein; Referenzquote 5–10 % ist eine Orientierung, keine Anweisung." },
    { id: "umcsent", title: "Konsumentenstimmung (U. Michigan)", keys: ["FRED_UMCSENT"], unitLabel: "Index", note: "Zusätzlicher Kontext." },
    { id: "debt", title: "US-Staatsverschuldung / BIP", keys: ["FRED_DEBT_GDP"], unitLabel: "%", note: "Langfristiger Risikokontext." },
  ];
  const out: MacroCard[] = [];
  for (const d of defs) {
    const s = await macro(d.keys, since);
    const lv = s ? lastValid(s.points) : null;
    out.push({ ...d, series: s, last: lv, changes: lv && s ? changes(s.points, lv.date, lv.value) : [] });
  }
  return out;
}

export async function buffettView() {
  const eq = await macro(["FRED_NCBE_EQUITY"]);
  const gdp = await macro(["FRED_GDP"]);
  if (!eq || !gdp) return null;
  const g = new Map(gdp.points.filter((p) => p.value != null).map((p) => [p.date, p.value!]));
  const pts = eq.points.filter((p) => p.value != null && g.has(p.date)).map((p) => ({ date: p.date, value: (p.value! / 1000 / g.get(p.date)!) * 100 }));
  return { points: pts, last: pts.at(-1) ?? null, method: "Marktwert Aktien nichtfinanzieller Unternehmen (Fed Z.1, NCBEILQ027S, Mio. USD) ÷ nominales BIP (Mrd. USD) × 100 – Näherung, Kontextindikator" };
}

/** Marktbreite für Regeln: eigenes Universum, sonst frische externe Angabe (≤ 7 Tage, mit Quelle). */
export const effectiveBreadth = cache(async (today: string) => {
  const b = await breadthView(today);
  const ext = b.external ? lastValid(b.external.points) : null;
  const extFresh = ext && (Date.parse(today) - Date.parse(ext.date)) / 86400000 <= 7 ? ext : null;
  if (!b.representative && extFresh) return { pctBelow: 100 - extFresh.value, evaluated: 0, representative: true, source: `extern: ${b.external!.provider} (${extFresh.date})` };
  return { pctBelow: b.current.pctBelow, evaluated: b.current.evaluated, representative: b.representative, source: b.current.evaluated ? `eigenes Universum (${b.current.evaluated} Titel)` : null };
});

export async function sectorView(today: string) {
  const etfs = await prisma.instrument.findMany({ where: { industry: SECTOR_ETF_TAG }, orderBy: { symbol: "asc" } });
  const spy = await prisma.instrument.findUnique({ where: { symbol: "SPY" } });
  if (!spy || !etfs.length) return null;
  const bm = await getBars(spy.id, "WEEK");
  const inputs = [];
  let provider: string | null = null, fetchedAt: Date | null = null;
  const splitNotes: string[] = [];
  for (const e of etfs) {
    const w = await getBars(e.id, "WEEK");
    provider = provider ?? w.provider;
    if (w.fetchedAt && (!fetchedAt || w.fetchedAt > fetchedAt)) fetchedAt = w.fetchedAt;
    inputs.push({ symbol: e.symbol, label: e.sector ?? e.symbol, bars: w.bars, splitSafe: splitSafe(w) });
    for (const a of w.split.applied) splitNotes.push(`${e.symbol}: ${a.date} Faktor ${a.factor} (${a.source})`);
    for (const p of w.split.problems) splitNotes.push(`${e.symbol}: ${p}`);
  }
  const rot = sectorRotation(inputs, bm.bars, undefined, splitSafe(bm));
  return { ...rot, provider, fetchedAt, isSnapshot: bm.isSnapshot, splitNotes, seasonality: seasonality(bm.bars, today, undefined, splitSafe(bm)) };
}

export async function marketOverview() {
  const general = await getGeneral();
  const today = todayIso(general.timezone);
  const cfg = await getRuleConfig();
  const [indices, breadth, cards, buffett, kalshi, sectors, cg] = await Promise.all([
    indexViews(), breadthView(today), macroCards(), buffettView(), prisma.setting.findUnique({ where: { key: "kalshiSnapshot" } }), sectorView(today), prisma.setting.findUnique({ where: { key: "cg:global" } }),
  ]);
  const spx = indices.find((i) => i.symbol === "SPY");
  const eff = await effectiveBreadth(today);
  const pctBelow = eff.pctBelow;
  const nearHigh = spx?.drawdownPct != null ? spx.drawdownPct >= -cfg.indexNearHighPct : null;
  const ruleA = {
    triggered: nearHigh != null && pctBelow != null ? nearHigh && pctBelow > cfg.breadthWeakBelowPct : null,
    nearHigh,
    pctBelow,
    representative: eff.representative,
    breadthSource: eff.source,
    pullback: spx?.drawdownPct != null ? spx.drawdownPct <= -cfg.marketPullbackPct : null,
  };
  const cryptoGlobal = (cg?.value as (CryptoGlobal & { fetchedAt: string }) | undefined) ?? null;
  return { today, indices, breadth, cards, buffett, ruleA, cfg, sectors, cryptoGlobal, fomc: upcomingFomc(today, 4), kalshi: kalshi?.value as { fetchedAt: string; markets: { ticker: string; title: string; subtitle: string | null; impliedPct: number | null; basis: string; closeTime: string | null }[] } | null };
}

export { distancePct };
