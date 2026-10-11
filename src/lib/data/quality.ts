/**
 * Datenqualitätsstatus – unterscheidet konsequent echte, verspätete, zwischengespeicherte,
 * historische, geschätzte, Demo- und fehlende Daten. Wird von jeder Kennzahl in der UI genutzt.
 */

export type DataState =
  | "AKTUELL" // aktuellster erwartbarer Datenstand (z. B. letzter Tagesschluss)
  | "VERZÖGERT" // Provider liefert bewusst verzögert
  | "ZWISCHENGESPEICHERT" // aus Cache/DB, älter als erwartet, aber noch brauchbar
  | "VERALTET" // deutlich älter als erwartet
  | "SNAPSHOT" // einmaliger echter Abruf (z. B. Entwicklungs-Snapshot), nicht laufend aktualisiert
  | "HISTORISCH" // echte historische Daten, kein aktueller Anspruch
  | "GESCHÄTZT" // Schätzung/Modell
  | "MANUELL" // vom Nutzer eingegeben
  | "DEMO" // synthetische Testdaten
  | "FEHLT";

export const STATE_LABEL: Record<DataState, string> = {
  AKTUELL: "aktuell",
  VERZÖGERT: "verzögert",
  ZWISCHENGESPEICHERT: "zwischengespeichert",
  VERALTET: "veraltet",
  SNAPSHOT: "Snapshot",
  HISTORISCH: "historisch",
  GESCHÄTZT: "geschätzt",
  MANUELL: "manuell",
  DEMO: "DEMO – keine Marktdaten",
  FEHLT: "fehlt",
};

export type Frequency = "intraday" | "daily" | "weekly" | "monthly" | "quarterly" | "event";

/** Werktage (Mo–Fr) zwischen zwei Daten, exklusive Start, inklusive Ende. Feiertage unberücksichtigt. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z");
  const b = new Date(toIso + "T00:00:00Z");
  if (b <= a) return 0;
  let n = 0;
  const d = new Date(a);
  while (d < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

const TOLERANCE: Record<Frequency, { ok: number; stale: number; unit: "bd" | "d" }> = {
  intraday: { ok: 0, stale: 1, unit: "bd" },
  daily: { ok: 1, stale: 3, unit: "bd" }, // Tagesschluss von gestern ist „aktuell“
  weekly: { ok: 8, stale: 15, unit: "d" },
  monthly: { ok: 45, stale: 75, unit: "d" },
  quarterly: { ok: 120, stale: 200, unit: "d" },
  event: { ok: 100000, stale: 100000, unit: "d" },
};

export interface Freshness {
  state: DataState;
  label: string;
  dataDate: string | null;
  fetchedAt: string | null;
  age: number | null;
  ageUnit: "Werktage" | "Tage";
  explanation: string;
}

export function assessFreshness(input: {
  dataDate: string | null;
  fetchedAt: Date | string | null;
  frequency: Frequency;
  today: string;
  provider?: string | null;
  isDemo?: boolean;
  isManual?: boolean;
  isEstimate?: boolean;
  isSnapshot?: boolean;
}): Freshness {
  const fetched = input.fetchedAt ? (typeof input.fetchedAt === "string" ? input.fetchedAt : input.fetchedAt.toISOString()) : null;
  const base = { dataDate: input.dataDate, fetchedAt: fetched };
  const mk = (state: DataState, age: number | null, unit: "Werktage" | "Tage", explanation: string): Freshness => ({ ...base, state, label: STATE_LABEL[state], age, ageUnit: unit, explanation });
  if (input.isDemo) return mk("DEMO", null, "Tage", "Synthetische Demodaten – nicht für Entscheidungen verwenden.");
  if (!input.dataDate) return mk("FEHLT", null, "Tage", "Kein Datenpunkt vorhanden.");
  if (input.isEstimate) return mk("GESCHÄTZT", null, "Tage", "Schätz- bzw. Modellwert.");
  if (input.isManual) return mk("MANUELL", null, "Tage", "Vom Nutzer eingegeben; Aktualität selbst prüfen.");
  const tol = TOLERANCE[input.frequency];
  const age = tol.unit === "bd" ? businessDaysBetween(input.dataDate, input.today) : Math.round((Date.parse(input.today) - Date.parse(input.dataDate)) / 86400000);
  const unit = tol.unit === "bd" ? "Werktage" : "Tage";
  if (input.isSnapshot) return mk(age <= tol.ok ? "SNAPSHOT" : "VERALTET", age, unit, `Einmaliger echter Abruf; Datenstand ${input.dataDate}. Keine laufende Aktualisierung.`);
  if (age <= tol.ok) return mk("AKTUELL", age, unit, "Neuester erwartbarer Datenstand.");
  if (age <= tol.stale) return mk("ZWISCHENGESPEICHERT", age, unit, `Datenstand ${age} ${unit} alt.`);
  return mk("VERALTET", age, unit, `Datenstand ${age} ${unit} alt – Aktualisierung fehlgeschlagen oder Quelle liefert nicht mehr.`);
}
