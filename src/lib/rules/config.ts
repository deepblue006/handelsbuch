/**
 * Konfigurierbare Schwellenwerte. Startwerte entstammen der Nutzer-Zusammenstellung
 * „Marktdaten, die Finanzwiesel nutzt“ (Stand 11.10.2026) und sind Referenzwerte –
 * keine unabhängig bestätigten Strategieaussagen. Alle Werte sind in den Einstellungen änderbar.
 */
import { z } from "zod";

export const RuleConfigSchema = z.object({
  // Regel A – Marktlage
  breadthWeakBelowPct: z.number().min(0).max(100).default(50), // > X % unter 200-Tage-Linie
  indexNearHighPct: z.number().min(0).max(50).default(3), // Index innerhalb X % vom Hoch
  referenceCashQuotaPct: z.number().min(0).max(100).default(15),
  marketPullbackPct: z.number().min(0).max(80).default(10),
  // Regel B – Kursanstiege und Rücksetzer
  rallyPct: z.number().min(0).max(500).default(20),
  rallyWindowDays: z.number().int().min(1).max(250).default(20),
  selloffPct: z.number().min(0).max(100).default(10),
  selloffWindowDays: z.number().int().min(1).max(30).default(5),
  waitDaysAfterSelloff: z.number().int().min(0).max(30).default(3),
  rebuyMark1Pct: z.number().min(0).max(100).default(15),
  rebuyMark2Pct: z.number().min(0).max(100).default(30),
  ruleOf20Pct: z.number().min(0).max(100).default(20),
  // Regel C – Trend & RSI
  rsiOversold: z.number().min(0).max(100).default(30),
  rsiOverbought: z.number().min(0).max(100).default(70),
  near200dPct: z.number().min(0).max(20).default(3),
  // Regel D – Bewertung & Termine
  earningsWindowDays: z.number().int().min(0).max(60).default(10),
  downgradeLookbackDays: z.number().int().min(1).max(90).default(10),
  // Allgemein
  minScoreCompleteness: z.number().min(0).max(1).default(0.5),
  goldReferenceMinPct: z.number().min(0).max(100).default(5),
  goldReferenceMaxPct: z.number().min(0).max(100).default(10),
  // Bewertungsheuristiken (grobe Orientierung)
  pegCheapBelow: z.number().default(1),
  pegExpensiveAbove: z.number().default(2),
  fcfYieldInterestingPct: z.number().default(3.5),
  revenueGrowthMinPct: z.number().default(10),
  revenueGrowthTargetLowPct: z.number().default(15),
  revenueGrowthTargetHighPct: z.number().default(20),
  evSalesRefLow: z.number().default(5),
  evSalesRefHigh: z.number().default(10),
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;
export const DEFAULT_RULE_CONFIG: RuleConfig = RuleConfigSchema.parse({});

export const ScoreWeightsSchema = z.object({
  technical: z.number().min(0).default(20),
  fundamental: z.number().min(0).default(20),
  market: z.number().min(0).default(15),
  operational: z.number().min(0).default(15), // On-Chain bzw. operative Kennzahlen
  flows: z.number().min(0).default(15),
  sentiment: z.number().min(0).default(5),
  portfolioFit: z.number().min(0).default(10),
});
export type ScoreWeights = z.infer<typeof ScoreWeightsSchema>;
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = ScoreWeightsSchema.parse({});

export const GeneralSettingsSchema = z.object({
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  monthlyBudget: z.number().min(0).default(0),
  targetCashQuotaPct: z.number().min(0).max(100).default(15),
  maxPositionWeightPct: z.number().min(0).max(100).default(15),
  timezone: z.string().default("Europe/Berlin"),
  // Startpräferenz Krypto laut Zusammenstellung (Entscheidung 08.10.2026) – editierbar, keine Automatik
  cryptoPreference: z.string().default("HOLD_ONLY"),
  cryptoPreferenceNote: z.string().default("Vorläufige Präferenz „nur halten“ (Entscheidung vom 08.10.2026). Editierbar; löst keine Aktion aus."),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
export const DEFAULT_GENERAL: GeneralSettings = GeneralSettingsSchema.parse({});
