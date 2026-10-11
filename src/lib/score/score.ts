/**
 * Kaufsignalscore – Orientierung, keine Kaufempfehlung.
 *
 * Jede Komponente liefert 0–100 oder `null` (Daten fehlen). Fehlende Komponenten werden
 * NICHT als neutral gewertet: Der Gesamtwert wird nur aus verfügbaren Komponenten gebildet
 * (Gewichte proportional umverteilt) und die Vollständigkeit wird ausgewiesen.
 * Politikertransaktionen und Truth-Social-Posts sind ausdrücklich keine Komponenten.
 */
import type { ScoreWeights } from "../rules/config";
import type { RuleEvaluation } from "../rules/engine";

export type ComponentKey = keyof ScoreWeights;

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  technical: "Technische Lage",
  fundamental: "Bewertung & Unternehmensqualität",
  market: "Marktumfeld & relative Stärke",
  operational: "On-Chain- bzw. operative Kennzahlen",
  flows: "Institutionelle Geldflüsse",
  sentiment: "Sentiment",
  portfolioFit: "Portfolio-Fit & Risiko",
};

export interface Factor {
  label: string;
  points: number; // Beitrag in Punkten (−/+), relativ zur Komponentenbasis 50
  value: string;
}

export interface ComponentScore {
  key: ComponentKey;
  score: number | null;
  factors: Factor[];
  dataUsed: string[];
  missing: string[];
  asOf: string | null;
}

/** Baut eine Komponente aus Faktoren: Basis 50, Summe der Punkte, begrenzt auf 0–100. Ohne Faktoren → null. */
export function componentFromFactors(key: ComponentKey, factors: Factor[], dataUsed: string[], missing: string[], asOf: string | null): ComponentScore {
  if (!factors.length) return { key, score: null, factors, dataUsed, missing, asOf };
  const raw = 50 + factors.reduce((s, f) => s + f.points, 0);
  return { key, score: Math.max(0, Math.min(100, raw)), factors, dataUsed, missing, asOf };
}

export type SignalState =
  | "INTERESSANT_FÜR_PRÜFUNG"
  | "MÖGLICHER_EINSTIEG"
  | "MÖGLICHER_GESTAFFELTER_NACHKAUF"
  | "ABWARTEN"
  | "ERHÖHTES_RISIKO"
  | "THESE_NEU_PRÜFEN"
  | "DATENLAGE_NICHT_AUSREICHEND";

export const STATE_LABELS: Record<SignalState, string> = {
  INTERESSANT_FÜR_PRÜFUNG: "Interessant für weitere Prüfung",
  MÖGLICHER_EINSTIEG: "Möglicher Einstieg",
  MÖGLICHER_GESTAFFELTER_NACHKAUF: "Möglicher gestaffelter Nachkauf",
  ABWARTEN: "Abwarten",
  ERHÖHTES_RISIKO: "Erhöhtes Risiko",
  THESE_NEU_PRÜFEN: "These neu prüfen",
  DATENLAGE_NICHT_AUSREICHEND: "Datenlage nicht ausreichend",
};

export interface ScoreResult {
  total: number | null;
  completeness: number; // Anteil der verfügbaren Gewichte (0–1)
  effectiveWeights: Partial<Record<ComponentKey, number>>; // nach Umverteilung, Summe 100
  components: ComponentScore[];
  state: SignalState;
  stateReason: string;
  positives: string[];
  negatives: string[];
  warnings: string[];
  againstBuying: string[];
}

export function aggregateScore(
  components: ComponentScore[],
  weights: ScoreWeights,
  rules: RuleEvaluation,
  opts: { isHeld: boolean; thesisIntact: boolean | null; minCompleteness: number },
): ScoreResult {
  const totalWeight = (Object.keys(weights) as ComponentKey[]).reduce((s, k) => s + weights[k], 0);
  const available = components.filter((c) => c.score != null && weights[c.key] > 0);
  const availWeight = available.reduce((s, c) => s + weights[c.key], 0);
  const completeness = totalWeight > 0 ? availWeight / totalWeight : 0;
  const effectiveWeights: Partial<Record<ComponentKey, number>> = {};
  for (const c of available) effectiveWeights[c.key] = availWeight > 0 ? (weights[c.key] / availWeight) * 100 : 0;
  const total = availWeight > 0 ? available.reduce((s, c) => s + c.score! * weights[c.key], 0) / availWeight : null;

  const positives: string[] = [];
  const negatives: string[] = [];
  for (const c of components) for (const f of c.factors) {
    if (f.points > 0) positives.push(`${COMPONENT_LABELS[c.key]}: ${f.label} (${f.value})`);
    if (f.points < 0) negatives.push(`${COMPONENT_LABELS[c.key]}: ${f.label} (${f.value})`);
  }
  const againstBuying = [...rules.cons.map((r) => `${r.id}: ${r.message}`), ...negatives];
  const warnings = [...rules.conflicts];
  if (completeness < 1) warnings.push(`Score unvollständig: ${(completeness * 100).toFixed(0)} % der Gewichte mit Daten hinterlegt; fehlende Komponenten wurden nicht als neutral gezählt.`);

  const { state, reason } = deriveState(total, completeness, rules, opts);
  return { total, completeness, effectiveWeights, components, state, stateReason: reason, positives, negatives, warnings, againstBuying };
}

/**
 * Zustandslogik (Reihenfolge = Priorität):
 * 1. Vollständigkeit unter Mindestwert → Datenlage nicht ausreichend
 * 2. These als verletzt markiert → These neu prüfen
 * 3. Stage 4 oder schwache Marktbreite → Erhöhtes Risiko
 * 4. Über Fair Value, Quartalszahlen in Kürze oder Abverkauf-Wartezeit → Abwarten
 * 5. Gehaltene Position mit Nachkaufmarke und Score ≥ 55 → Möglicher gestaffelter Nachkauf
 * 6. Score ≥ 65 ohne Contra-Regeln → Möglicher Einstieg
 * 7. Score ≥ 50 → Interessant für weitere Prüfung, sonst Abwarten
 */
export function deriveState(
  total: number | null,
  completeness: number,
  rules: RuleEvaluation,
  opts: { isHeld: boolean; thesisIntact: boolean | null; minCompleteness: number },
): { state: SignalState; reason: string } {
  const fired = (id: string) => rules.outcomes.some((o) => o.id === id && o.status === "AUSGELÖST");
  if (total == null || completeness < opts.minCompleteness) return { state: "DATENLAGE_NICHT_AUSREICHEND", reason: `Nur ${(completeness * 100).toFixed(0)} % der Score-Gewichte mit Daten (Minimum ${(opts.minCompleteness * 100).toFixed(0)} %).` };
  if (opts.thesisIntact === false) return { state: "THESE_NEU_PRÜFEN", reason: "Investmentthese ist als verletzt markiert." };
  if (fired("C3_STAGE4")) return { state: "ERHÖHTES_RISIKO", reason: "Kurs unter fallender 30-Wochen-Linie (Stage 4)." };
  if (fired("A1_MARKTBREITE_SCHWACH")) return { state: "ERHÖHTES_RISIKO", reason: "Schwache Marktbreite nahe Indexhoch." };
  if (fired("D1_UEBER_FAIR_VALUE") && !opts.isHeld) return { state: "ABWARTEN", reason: "Kurs über modelliertem Fair Value – kein Neukauf allein aufgrund anderer Signale." };
  if (fired("D2_QUARTALSZAHLEN")) return { state: "ABWARTEN", reason: "Quartalszahlen innerhalb des Ergebnisrisiko-Fensters." };
  if (fired("B2_ABVERKAUF_ABWARTEN")) return { state: "ABWARTEN", reason: "Wartezeit nach Abverkauf läuft." };
  if (opts.isHeld && (fired("B3_NACHKAUFMARKE") || fired("C5_NAEHE_200T") || fired("C1_RSI_UEBERVERKAUFT")) && total >= 55) {
    return { state: "MÖGLICHER_GESTAFFELTER_NACHKAUF", reason: `Score ${total.toFixed(0)} und Nachkauf-Prüfsignal; These ${opts.thesisIntact ? "als intakt markiert" : "noch nicht bewertet"}.` };
  }
  if (total >= 65 && rules.cons.length === 0) return { state: "MÖGLICHER_EINSTIEG", reason: `Score ${total.toFixed(0)} ohne ausgelöste Contra-Regel.` };
  if (total >= 50) return { state: "INTERESSANT_FÜR_PRÜFUNG", reason: `Score ${total.toFixed(0)}${rules.cons.length ? `, aber ${rules.cons.length} Contra-Regel(n)` : ""}.` };
  return { state: "ABWARTEN", reason: `Score ${total.toFixed(0)} unter 50.` };
}
