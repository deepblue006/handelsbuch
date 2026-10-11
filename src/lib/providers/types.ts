/**
 * Gemeinsame Typen der Provider-Schicht. Alle Adapter bilden auf diese internen Modelle ab,
 * damit Quellen austauschbar bleiben.
 */

/** Verifikationsstand einer Quelle – im Dashboard sichtbar. */
export type Verification =
  | "LIVE_GETESTET" // aus der App heraus erfolgreich abgerufen
  | "FORMAT_VERIFIZIERT" // echte Antwort liegt vor (z. B. Snapshot), App-Abruf hier nicht getestet
  | "UNGEPRÜFT" // Adapter nach Dokumentation gebaut, nicht gegen echte Antwort getestet
  | "NICHT_IMPLEMENTIERT" // bewusst kein Adapter (Zugang, Nutzungsbedingungen oder Kosten)
  | "NUR_LINK"; // nur Verweis, manuelle Nutzung

export type Category =
  | "KURSE"
  | "FUNDAMENTAL"
  | "TERMINE"
  | "MAKRO"
  | "ZINSERWARTUNG"
  | "FLOWS"
  | "KRYPTO"
  | "POLITIK"
  | "SOCIAL"
  | "INSIDER_13F"
  | "SEKTOREN"
  | "DEMO";

export interface ProviderInfo {
  id: string;
  name: string;
  categories: Category[];
  official: boolean; // offizielle Quelle (Behörde, Notenbank, Emittent)
  website: string;
  docsUrl?: string;
  envKeys: string[]; // benötigte Umgebungsvariablen
  requiresKey: boolean;
  cost: string;
  rateLimit: string;
  updateFrequency: string;
  delay: string;
  history: string;
  terms: string; // Nutzungsbedingungen / Einschränkungen (Stand der Prüfung)
  fields: string[]; // gelieferte Felder
  notProvided: string[]; // bekannte Lücken
  verification: Verification;
  verificationNote: string;
  implemented: boolean;
  defaultEnabled: boolean;
}

export interface DailyBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface BarSeries {
  symbol: string;
  currency: string;
  interval: "DAY" | "WEEK";
  adjusted: boolean;
  lastRefreshed: string | null;
  timeZone: string | null;
  bars: DailyBar[]; // aufsteigend
  partialLastBar: boolean; // letzte Kerze ggf. unvollständig (laufender Tag/Woche)
}

export interface MacroPoint {
  date: string;
  value: number | null; // null = vom Provider als fehlend gemeldet
}

export interface MacroSeriesData {
  key: string;
  name: string;
  unit: string;
  points: MacroPoint[]; // aufsteigend
}

export interface QuoteData {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  quoteTime: string | null;
  latestTradingDay: string | null;
  currency: string;
  delayNote: string;
}

export interface EarningsData {
  symbol: string;
  reportDate: string;
  fiscalPeriodEnd: string | null;
  epsEstimate: number | null;
  currency: string | null;
  timeOfDay: string | null;
}
