/**
 * Transparentes Regelwerk (Regeln A–D). Jede Regel hat Kennung, Erklärung, Eingangsdaten,
 * Schwelle, mögliche Reaktion und Grenzen. Regeln lösen niemals Transaktionen aus.
 */
import type { RuleConfig } from "./config";
import type { StageResult } from "../calc/indicators";

export type RuleStatus = "AUSGELÖST" | "NICHT_AUSGELÖST" | "DATEN_FEHLEN" | "NICHT_ANWENDBAR";
export type RuleDirection = "PRO" | "CONTRA" | "PRÜFEN" | "INFO";
export type RuleOrigin = "FINANZWIESEL_REFERENZ" | "DASHBOARD_ERWEITERUNG";

export interface RuleContext {
  symbol: string;
  assetType: "STOCK" | "ETF" | "CRYPTO" | "INDEX_PROXY" | "OTHER";
  today: string;
  isHeld: boolean;
  price: number | null;
  priceDate: string | null;
  dailyCloses: { date: string; close: number }[];
  rsi14: number | null;
  sma200: number | null;
  stage: StageResult | null;
  avgCost: number | null; // Einstand je Stück in Handelswährung
  fairValue: number | null; // Basisszenario, gleiche Währung wie Kurs
  nextEarnings: { date: string; estimated: boolean } | null;
  earningsDataAvailable: boolean;
  recentDowngrades: number | null; // null = keine Analystendaten
  market: {
    indexLabel: string;
    indexDrawdownPct: number | null;
    pctBelow200: number | null;
    breadthEvaluated: number;
  };
  cashQuotaPct: number | null;
  thesisIntact: boolean | null; // vom Nutzer gepflegt; null = nicht bewertet
}

export interface RuleOutcome {
  id: string;
  group: "A" | "B" | "C" | "D";
  title: string;
  status: RuleStatus;
  direction: RuleDirection;
  message: string;
  inputs: Record<string, string | number | null>;
  threshold: string;
  reaction: string;
  limitations: string;
  origin: RuleOrigin;
}

export interface RuleDefinition {
  id: string;
  group: RuleOutcome["group"];
  title: string;
  explanation: string;
  requiredInputs: string[];
  threshold: (c: RuleConfig) => string;
  reaction: string;
  limitations: string;
  direction: RuleDirection;
  appliesTo: RuleContext["assetType"][];
  evaluate: (ctx: RuleContext, c: RuleConfig) => { status: RuleStatus; message: string; inputs: RuleOutcome["inputs"] };
}

const EQUITY: RuleContext["assetType"][] = ["STOCK", "ETF"];
const ALL: RuleContext["assetType"][] = ["STOCK", "ETF", "CRYPTO", "INDEX_PROXY", "OTHER"];

const fmt = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** Maximaler Anstieg vom Tief innerhalb des Fensters bis zum letzten Kurs. */
function rallyInWindow(closes: { close: number }[], window: number): number | null {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-(window + 1));
  const last = slice[slice.length - 1]!.close;
  const min = Math.min(...slice.map((c) => c.close));
  return ((last - min) / min) * 100;
}

/** Stärkster Rückgang vom Hoch innerhalb des Fensters; Tag des Tiefs relativ zum Ende. */
function selloffInWindow(closes: { date: string; close: number }[], window: number) {
  if (closes.length < window + 1) return null;
  const slice = closes.slice(-(window + 1));
  let best = { pct: 0, lowDate: slice[slice.length - 1]!.date };
  let peak = slice[0]!.close;
  for (const c of slice) {
    if (c.close > peak) peak = c.close;
    const dd = ((c.close - peak) / peak) * 100;
    if (dd < best.pct) best = { pct: dd, lowDate: c.date };
  }
  return best;
}

export const RULES: RuleDefinition[] = [
  {
    id: "A1_MARKTBREITE_SCHWACH",
    group: "A",
    title: "Schwache Marktbreite nahe Indexhoch",
    explanation: "Steht ein Index nahe seinem Hoch, während die Mehrheit der beobachteten Aktien unter der 200-Tage-Linie liegt, wird der Anstieg von wenigen Titeln getragen.",
    requiredInputs: ["Indexabstand zum Hoch", "Anteil Titel unter SMA200"],
    threshold: (c) => `Index ≤ ${c.indexNearHighPct} % unter Hoch UND > ${c.breadthWeakBelowPct} % der Titel unter SMA200`,
    reaction: "Selektiver kaufen; Cashquote von ca. 15 % als Orientierung prüfen. Keine automatische Transaktion.",
    limitations: "Aussagekraft hängt vom Universum ab. Kleine Universen (wenige Titel) sind nicht repräsentativ für den Gesamtmarkt.",
    direction: "CONTRA",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const inputs = { indexAbstandHochPct: fmt(x.market.indexDrawdownPct), anteilUnterSma200Pct: fmt(x.market.pctBelow200), auswertbareTitel: x.market.breadthEvaluated, index: x.market.indexLabel };
      if (x.market.indexDrawdownPct == null || x.market.pctBelow200 == null) return { status: "DATEN_FEHLEN", message: "Indexverlauf oder Marktbreite fehlt.", inputs };
      const near = x.market.indexDrawdownPct >= -c.indexNearHighPct;
      const weak = x.market.pctBelow200 > c.breadthWeakBelowPct;
      if (near && weak) return { status: "AUSGELÖST", message: `${x.market.indexLabel} nahe Hoch (${fmt(x.market.indexDrawdownPct)} %), aber ${fmt(x.market.pctBelow200)} % der ${x.market.breadthEvaluated} Titel unter SMA200.`, inputs };
      return { status: "NICHT_AUSGELÖST", message: near ? "Index nahe Hoch, Marktbreite ausreichend." : "Index nicht nahe Hoch.", inputs };
    },
  },
  {
    id: "A2_CASHQUOTE_ORIENTIERUNG",
    group: "A",
    title: "Cashquote im Vergleich zur Referenz",
    explanation: "Bei schwacher Marktbreite nennt die Zusammenstellung ca. 15 % Cash als Orientierung.",
    requiredInputs: ["Cashquote", "Marktbreite"],
    threshold: (c) => `Cashquote < ${c.referenceCashQuotaPct} % bei schwacher Marktbreite`,
    reaction: "Prüfen, ob Liquidität für spätere Gelegenheiten vorgehalten werden soll.",
    limitations: "Persönliche Situation, Sparpläne und Anlagehorizont sind wichtiger als ein pauschaler Wert.",
    direction: "PRÜFEN",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const inputs = { cashquotePct: fmt(x.cashQuotaPct), referenzPct: c.referenceCashQuotaPct, anteilUnterSma200Pct: fmt(x.market.pctBelow200) };
      if (x.cashQuotaPct == null || x.market.pctBelow200 == null) return { status: "DATEN_FEHLEN", message: "Cashquote oder Marktbreite fehlt.", inputs };
      if (x.market.pctBelow200 > c.breadthWeakBelowPct && x.cashQuotaPct < c.referenceCashQuotaPct) return { status: "AUSGELÖST", message: `Cashquote ${fmt(x.cashQuotaPct)} % unter Referenz ${c.referenceCashQuotaPct} % bei schwacher Breite.`, inputs };
      return { status: "NICHT_AUSGELÖST", message: "Keine Abweichung, die eine Prüfung nahelegt.", inputs };
    },
  },
  {
    id: "A3_MARKTRUECKSETZER",
    group: "A",
    title: "Breiter Marktrücksetzer",
    explanation: "Bei einem Rücksetzer des Gesamtmarkts um ca. 10 % kann geprüft werden, vorgesehenes Kapital schrittweise einzusetzen.",
    requiredInputs: ["Indexabstand zum Hoch"],
    threshold: (c) => `Index ≥ ${c.marketPullbackPct} % unter Hoch`,
    reaction: "Schrittweisen Einsatz geplanter Liquidität prüfen – nicht ungeprüft gegen andere Risikohinweise.",
    limitations: "Ein Rücksetzer kann sich ausweiten. Marktbreite, Liquidität, Thesen und persönliche Grenzen prüfen.",
    direction: "PRÜFEN",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const inputs = { indexAbstandHochPct: fmt(x.market.indexDrawdownPct), index: x.market.indexLabel };
      if (x.market.indexDrawdownPct == null) return { status: "DATEN_FEHLEN", message: "Indexverlauf fehlt.", inputs };
      if (x.market.indexDrawdownPct <= -c.marketPullbackPct) return { status: "AUSGELÖST", message: `${x.market.indexLabel} ${fmt(x.market.indexDrawdownPct)} % unter Hoch.`, inputs };
      return { status: "NICHT_AUSGELÖST", message: `Rücksetzer ${fmt(x.market.indexDrawdownPct)} % – unter Schwelle.`, inputs };
    },
  },
  {
    id: "B1_NICHT_HINTERHERKAUFEN",
    group: "B",
    title: "Starker Kursanstieg in kurzer Zeit",
    explanation: "Nach einem Anstieg von ca. 20–30 % in kurzer Zeit nicht automatisch hinterherkaufen.",
    requiredInputs: ["Tagesschlusskurse"],
    threshold: (c) => `Anstieg ≥ ${c.rallyPct} % innerhalb ${c.rallyWindowDays} Handelstagen`,
    reaction: "Rücksetzer oder bessere Einstiegsgelegenheit abwarten.",
    limitations: "Starke Trends können lange anhalten; die Regel kann Gelegenheiten verpassen.",
    direction: "CONTRA",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const r = rallyInWindow(x.dailyCloses, c.rallyWindowDays);
      const inputs = { anstiegPct: fmt(r), fensterTage: c.rallyWindowDays };
      if (r == null) return { status: "DATEN_FEHLEN", message: "Zu wenige Tageskurse.", inputs };
      return r >= c.rallyPct ? { status: "AUSGELÖST", message: `+${fmt(r)} % vom Tief der letzten ${c.rallyWindowDays} Tage.`, inputs } : { status: "NICHT_AUSGELÖST", message: `+${fmt(r)} % – unter Schwelle.`, inputs };
    },
  },
  {
    id: "B2_ABVERKAUF_ABWARTEN",
    group: "B",
    title: "Nach starkem Abverkauf abwarten",
    explanation: "Nach einem Abverkauf ca. drei Tage abwarten und Analysten-Herabstufungen sowie neue Unternehmensinformationen prüfen.",
    requiredInputs: ["Tagesschlusskurse", "Analystenmaßnahmen (optional)"],
    threshold: (c) => `Rückgang ≥ ${c.selloffPct} % in ${c.selloffWindowDays} Tagen; Wartezeit ${c.waitDaysAfterSelloff} Tage`,
    reaction: "Wartezeit einhalten, Herabstufungen und Meldungen prüfen.",
    limitations: "Heuristik – keine Garantie, dass der Tiefpunkt erreicht ist.",
    direction: "CONTRA",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const s = selloffInWindow(x.dailyCloses, c.selloffWindowDays);
      const inputs = { rueckgangPct: fmt(s?.pct ?? null), tiefAm: s?.lowDate ?? null, herabstufungen: x.recentDowngrades };
      if (!s) return { status: "DATEN_FEHLEN", message: "Zu wenige Tageskurse.", inputs };
      if (s.pct > -c.selloffPct) return { status: "NICHT_AUSGELÖST", message: "Kein starker Abverkauf im Fenster.", inputs };
      const since = daysBetween(s.lowDate, x.today);
      const dg = x.recentDowngrades == null ? "Analystendaten fehlen" : `${x.recentDowngrades} Herabstufung(en) im Rückblick`;
      if (since < c.waitDaysAfterSelloff) return { status: "AUSGELÖST", message: `Abverkauf ${fmt(s.pct)} %, Tief vor ${since} Tag(en) – Wartezeit läuft. ${dg}.`, inputs };
      return { status: "NICHT_AUSGELÖST", message: `Abverkauf ${fmt(s.pct)} %, Wartezeit abgelaufen. ${dg}.`, inputs };
    },
  },
  {
    id: "B3_NACHKAUFMARKE",
    group: "B",
    title: "Prüfmarke für Nachkauf (−15 % / −30 %)",
    explanation: "Liegt eine Position ca. 15 % oder 30 % unter dem Einstand, wird eine Prüfmarke angezeigt – zuerst These und technische Zone prüfen.",
    requiredInputs: ["Einstand", "aktueller Kurs"],
    threshold: (c) => `Kurs ≤ Einstand −${c.rebuyMark1Pct} % bzw. −${c.rebuyMark2Pct} %`,
    reaction: "Investmentthese und mögliche Nachkaufzone prüfen. Ein Verlust allein ist kein Kaufgrund.",
    limitations: "Nachkaufen kann Verluste vergrößern, wenn die These gebrochen ist.",
    direction: "PRÜFEN",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const pct = x.price != null && x.avgCost ? ((x.price - x.avgCost) / x.avgCost) * 100 : null;
      const inputs = { abstandEinstandPct: fmt(pct), theseIntakt: x.thesisIntact == null ? null : x.thesisIntact ? "ja" : "nein" };
      if (!x.isHeld) return { status: "NICHT_ANWENDBAR", message: "Keine bestehende Position.", inputs };
      if (pct == null) return { status: "DATEN_FEHLEN", message: "Kurs oder Einstand fehlt.", inputs };
      if (pct <= -c.rebuyMark2Pct) return { status: "AUSGELÖST", message: `${fmt(pct)} % unter Einstand (Marke −${c.rebuyMark2Pct} %).`, inputs };
      if (pct <= -c.rebuyMark1Pct) return { status: "AUSGELÖST", message: `${fmt(pct)} % unter Einstand (Marke −${c.rebuyMark1Pct} %).`, inputs };
      return { status: "NICHT_AUSGELÖST", message: `${fmt(pct)} % zum Einstand.`, inputs };
    },
  },
  {
    id: "B4_RULE_OF_20",
    group: "B",
    title: "Rule of 20",
    explanation: "Bei ca. −20 % zum Einstand: Besteht die These noch? Ist im Portfolio Platz? Ist Nachkaufen, Halten oder Verkaufen plausibel?",
    requiredInputs: ["Einstand", "aktueller Kurs", "Thesenstatus"],
    threshold: (c) => `Kurs ≤ Einstand −${c.ruleOf20Pct} %`,
    reaction: "Checkliste durchgehen: These, Portfolioplatz, Handlungsoptionen.",
    limitations: "Prüfroutine, keine Handlungsanweisung.",
    direction: "PRÜFEN",
    appliesTo: EQUITY,
    evaluate: (x, c) => {
      const pct = x.price != null && x.avgCost ? ((x.price - x.avgCost) / x.avgCost) * 100 : null;
      const inputs = { abstandEinstandPct: fmt(pct) };
      if (!x.isHeld) return { status: "NICHT_ANWENDBAR", message: "Keine bestehende Position.", inputs };
      if (pct == null) return { status: "DATEN_FEHLEN", message: "Kurs oder Einstand fehlt.", inputs };
      return pct <= -c.ruleOf20Pct ? { status: "AUSGELÖST", message: `${fmt(pct)} % – Rule-of-20-Prüfung fällig.`, inputs } : { status: "NICHT_AUSGELÖST", message: "Schwelle nicht erreicht.", inputs };
    },
  },
  {
    id: "C1_RSI_UEBERVERKAUFT",
    group: "C",
    title: "RSI 14 unter 30",
    explanation: "Gestaffelte Einstiege als möglicher Ansatz; das Kurstief kann zeitlich nach dem RSI-Tief folgen.",
    requiredInputs: ["RSI 14"],
    threshold: (c) => `RSI14 < ${c.rsiOversold}`,
    reaction: "Gestaffelte Einstiegsmöglichkeit prüfen.",
    limitations: "Überverkauft heißt nicht günstig; in Abwärtstrends kann der RSI lange niedrig bleiben.",
    direction: "PRO",
    appliesTo: ALL,
    evaluate: (x, c) => {
      const inputs = { rsi14: fmt(x.rsi14) };
      if (x.rsi14 == null) return { status: "DATEN_FEHLEN", message: "RSI nicht berechenbar.", inputs };
      return x.rsi14 < c.rsiOversold ? { status: "AUSGELÖST", message: `RSI14 = ${fmt(x.rsi14)}.`, inputs } : { status: "NICHT_AUSGELÖST", message: `RSI14 = ${fmt(x.rsi14)}.`, inputs };
    },
  },
  {
    id: "C2_RSI_UEBERKAUFT",
    group: "C",
    title: "RSI 14 über 70",
    explanation: "Einem stark gestiegenen Kurs nicht hinterherlaufen; Kauf ggf. auf Beruhigung warten lassen.",
    requiredInputs: ["RSI 14"],
    threshold: (c) => `RSI14 > ${c.rsiOverbought}`,
    reaction: "Zurückhaltung bei Neu- und Nachkäufen prüfen.",
    limitations: "Überkauft heißt nicht verkaufen; starke Aufwärtstrends zeigen oft hohe RSI-Werte.",
    direction: "CONTRA",
    appliesTo: ALL,
    evaluate: (x, c) => {
      const inputs = { rsi14: fmt(x.rsi14) };
      if (x.rsi14 == null) return { status: "DATEN_FEHLEN", message: "RSI nicht berechenbar.", inputs };
      return x.rsi14 > c.rsiOverbought ? { status: "AUSGELÖST", message: `RSI14 = ${fmt(x.rsi14)}.`, inputs } : { status: "NICHT_AUSGELÖST", message: `RSI14 = ${fmt(x.rsi14)}.`, inputs };
    },
  },
  {
    id: "C3_STAGE4",
    group: "C",
    title: "Kurs unter fallender 30-Wochen-Linie (Stage 4)",
    explanation: "In Stage 4 grundsätzlich vorsichtig bleiben und Tranchen nicht automatisch vollständig einsetzen.",
    requiredInputs: ["Wochenschlusskurse (≥ 34)"],
    threshold: () => "Stage 4 nach Stage-Heuristik",
    reaction: "Vorsicht; Tranchen zurückhalten.",
    limitations: "Stage-Einteilung ist eine Heuristik; Übergänge sind unscharf.",
    direction: "CONTRA",
    appliesTo: ALL,
    evaluate: (x) => {
      const inputs = { stage: x.stage?.stage ?? null, steigung30WPct: fmt(x.stage?.slopePct ?? null), kursVs30WPct: fmt(x.stage?.priceVsMaPct ?? null) };
      if (!x.stage || x.stage.stage == null) return { status: "DATEN_FEHLEN", message: "Zu wenige Wochenkurse.", inputs };
      return x.stage.stage === 4 ? { status: "AUSGELÖST", message: x.stage.label, inputs } : { status: "NICHT_AUSGELÖST", message: x.stage.label, inputs };
    },
  },
  {
    id: "C4_30W_ZURUECKEROBERT",
    group: "C",
    title: "30-Wochen-Linie zurückerobert",
    explanation: "Stark gefallene Aktien nicht allein wegen des niedrigen Kurses kaufen; die Rückeroberung der 30-Wochen-Linie kann ein zusätzliches Stabilisierungssignal sein.",
    requiredInputs: ["Wochenschlusskurse"],
    threshold: () => "Wochenschluss über SMA30W nach Schlusskursen darunter in den Vorwochen",
    reaction: "Als zusätzliches Signal werten.",
    limitations: "Fehlsignale sind häufig, besonders bei seitwärts verlaufender Linie.",
    direction: "PRO",
    appliesTo: ALL,
    evaluate: (x) => {
      const inputs = { zurueckerobert: x.stage ? (x.stage.reclaimed ? "ja" : "nein") : null };
      if (!x.stage || x.stage.stage == null) return { status: "DATEN_FEHLEN", message: "Zu wenige Wochenkurse.", inputs };
      return x.stage.reclaimed ? { status: "AUSGELÖST", message: "Kurs hat die 30-Wochen-Linie zurückerobert.", inputs } : { status: "NICHT_AUSGELÖST", message: "Keine Rückeroberung in den letzten Wochen.", inputs };
    },
  },
  {
    id: "C5_NAEHE_200T",
    group: "C",
    title: "Nähe zur 200-Tage-Linie",
    explanation: "Die 200-Tage-Linie ist eine mögliche langfristige Nachkaufmarke, aber kein sicherer Boden.",
    requiredInputs: ["SMA200 (≥ 200 Tageskurse)"],
    threshold: (c) => `Kurs innerhalb ±${c.near200dPct} % der SMA200`,
    reaction: "Mögliche Nachkaufzone prüfen.",
    limitations: "Die Linie kann durchbrochen werden; Fundamentaldaten bleiben entscheidend.",
    direction: "PRO",
    appliesTo: ALL,
    evaluate: (x, c) => {
      const d = x.price != null && x.sma200 ? ((x.price - x.sma200) / x.sma200) * 100 : null;
      const inputs = { abstandSma200Pct: fmt(d) };
      if (d == null) return { status: "DATEN_FEHLEN", message: "SMA200 nicht berechenbar (zu wenige Tageskurse).", inputs };
      return Math.abs(d) <= c.near200dPct ? { status: "AUSGELÖST", message: `Kurs ${fmt(d)} % zur SMA200.`, inputs } : { status: "NICHT_AUSGELÖST", message: `Kurs ${fmt(d)} % zur SMA200.`, inputs };
    },
  },
  {
    id: "D1_UEBER_FAIR_VALUE",
    group: "D",
    title: "Kurs über modelliertem Fair Value",
    explanation: "Liegt der Kurs über dem modellierten Fair Value, wird kein Neukauf allein aufgrund positiver anderer Signale abgeleitet.",
    requiredInputs: ["Fair Value (Basisszenario)", "aktueller Kurs"],
    threshold: () => "Kurs > Fair Value Basisszenario",
    reaction: "Kein Neukauf allein wegen anderer Signale; Annahmen und Bandbreite prüfen.",
    limitations: "Fair Value ist ein Modellwert mit großer Unsicherheit und hängt stark von den Annahmen ab.",
    direction: "CONTRA",
    appliesTo: EQUITY,
    evaluate: (x) => {
      const inputs = { kurs: fmt(x.price, 2), fairValue: fmt(x.fairValue, 2) };
      if (x.price == null || x.fairValue == null) return { status: "DATEN_FEHLEN", message: "Kein Bewertungsmodell hinterlegt.", inputs };
      return x.price > x.fairValue ? { status: "AUSGELÖST", message: `Kurs ${fmt(x.price, 2)} über Fair Value ${fmt(x.fairValue, 2)}.`, inputs } : { status: "NICHT_AUSGELÖST", message: `Kurs unter Fair Value (${fmt(x.fairValue, 2)}).`, inputs };
    },
  },
  {
    id: "D2_QUARTALSZAHLEN",
    group: "D",
    title: "Quartalszahlen in Kürze",
    explanation: "Größere neue Positionen ca. zehn Tage vor Quartalszahlen möglichst vermeiden; alternativ kleine Testposition oder abwarten.",
    requiredInputs: ["nächster Berichtstermin"],
    threshold: (c) => `Termin innerhalb ${c.earningsWindowDays} Tagen`,
    reaction: "Auf Ergebnisrisiko hinweisen; Testposition oder Abwarten erwägen.",
    limitations: "Termine können sich verschieben; geschätzte Termine sind gekennzeichnet.",
    direction: "CONTRA",
    appliesTo: ["STOCK"],
    evaluate: (x, c) => {
      const days = x.nextEarnings ? daysBetween(x.today, x.nextEarnings.date) : null;
      const inputs = { termin: x.nextEarnings?.date ?? null, inTagen: days, terminGeschaetzt: x.nextEarnings ? (x.nextEarnings.estimated ? "ja" : "nein") : null };
      if (!x.earningsDataAvailable) return { status: "DATEN_FEHLEN", message: "Kein Terminkalender abgerufen.", inputs };
      if (days == null) return { status: "NICHT_AUSGELÖST", message: "Kein Termin im Abrufzeitraum gefunden.", inputs };
      return days >= 0 && days <= c.earningsWindowDays
        ? { status: "AUSGELÖST", message: `Zahlen am ${x.nextEarnings!.date} (in ${days} Tagen${x.nextEarnings!.estimated ? ", Termin geschätzt" : ""}).`, inputs }
        : { status: "NICHT_AUSGELÖST", message: `Nächster Termin in ${days} Tagen.`, inputs };
    },
  },
];

export interface RuleEvaluation {
  outcomes: RuleOutcome[];
  pros: RuleOutcome[];
  cons: RuleOutcome[];
  checks: RuleOutcome[];
  missing: RuleOutcome[];
  conflicts: string[];
  blocksNewBuy: boolean;
  nextSteps: string[];
}

export function evaluateRules(ctx: RuleContext, cfg: RuleConfig, rules: RuleDefinition[] = RULES): RuleEvaluation {
  const outcomes: RuleOutcome[] = rules.map((r) => {
    const base = { id: r.id, group: r.group, title: r.title, direction: r.direction, threshold: r.threshold(cfg), reaction: r.reaction, limitations: r.limitations };
    if (!r.appliesTo.includes(ctx.assetType)) {
      return { ...base, status: "NICHT_ANWENDBAR", message: ctx.assetType === "CRYPTO" ? "Regel stammt aus dem Aktien-Regelwerk der Referenzzusammenstellung; für Krypto nicht übernommen." : "Für diesen Asset-Typ nicht anwendbar.", inputs: {}, origin: "FINANZWIESEL_REFERENZ" };
    }
    const e = r.evaluate(ctx, cfg);
    const origin: RuleOrigin = ctx.assetType === "CRYPTO" ? "DASHBOARD_ERWEITERUNG" : "FINANZWIESEL_REFERENZ";
    return { ...base, ...e, origin };
  });
  const fired = outcomes.filter((o) => o.status === "AUSGELÖST");
  const pros = fired.filter((o) => o.direction === "PRO");
  const cons = fired.filter((o) => o.direction === "CONTRA");
  const checks = fired.filter((o) => o.direction === "PRÜFEN" || o.direction === "INFO");
  const missing = outcomes.filter((o) => o.status === "DATEN_FEHLEN");
  const conflicts: string[] = [];
  if (pros.length && cons.length) {
    conflicts.push(`Widersprüchliche Signale: dafür ${pros.map((p) => p.id).join(", ")} – dagegen ${cons.map((c) => c.id).join(", ")}. Signale werden nicht verrechnet.`);
  }
  const d1 = fired.find((o) => o.id === "D1_UEBER_FAIR_VALUE");
  if (d1 && pros.length) conflicts.push("Regel D1: Kurs über Fair Value – positive technische Signale begründen allein keinen Neukauf.");
  const c3 = fired.find((o) => o.id === "C3_STAGE4");
  if (c3 && fired.some((o) => o.id === "B3_NACHKAUFMARKE" || o.id === "C1_RSI_UEBERVERKAUFT")) conflicts.push("Rücksetzer/überverkauft, aber Stage 4: Tranchen nicht automatisch vollständig einsetzen.");

  const nextSteps: string[] = [];
  if (fired.some((o) => o.id === "B3_NACHKAUFMARKE" || o.id === "B4_RULE_OF_20")) nextSteps.push(ctx.thesisIntact == null ? "Investmentthese bewerten (Status fehlt)." : ctx.thesisIntact ? "These als intakt markiert – Nachkaufzone und Portfolioplatz prüfen." : "These als verletzt markiert – Halten/Reduzieren prüfen.");
  if (fired.some((o) => o.id === "B2_ABVERKAUF_ABWARTEN")) nextSteps.push("Wartezeit einhalten, Herabstufungen und Unternehmensmeldungen prüfen.");
  if (fired.some((o) => o.id === "D2_QUARTALSZAHLEN")) nextSteps.push("Zahlen abwarten oder nur kleine Testposition erwägen.");
  for (const m of missing) nextSteps.push(`Daten ergänzen für ${m.id}: ${m.message}`);

  return { outcomes, pros, cons, checks, missing, conflicts, blocksNewBuy: !!d1 && !ctx.isHeld, nextSteps };
}
