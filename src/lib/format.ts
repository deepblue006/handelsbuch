/** Deutsche Formatierung – Beträge immer mit Währung, Daten eindeutig. */
const cache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = cache.get(key);
  if (!f) { f = new Intl.NumberFormat("de-DE", opts); cache.set(key, f); }
  return f;
}
export function money(v: number | null | undefined, currency: string, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return nf(`m${currency}${digits}`, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
/** Umrechnungskurs für die Dollar-Anzeige neben Euro-Beträgen (Quelle und Datum werden ausgewiesen). */
export interface DisplayFx { usdPerEur: number | null; date: string | null; source: string | null }

/** Euro-Betrag mit Dollarwert daneben: „1.234,56 € (≈ 1.382,70 $)“. Andere Währungen unverändert; fehlt der Kurs: „(≈ – $)“. */
export function moneyDual(v: number | null | undefined, currency: string, fx: DisplayFx | null, digits = 2): string {
  const main = money(v, currency, digits);
  if (currency !== "EUR" || v == null || !Number.isFinite(v)) return main;
  if (!fx?.usdPerEur) return `${main} (≈ – $)`;
  return `${main} (≈ ${money(v * fx.usdPerEur, "USD", digits)})`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return nf(`n${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}
export function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return nf("q", { maximumFractionDigits: 8 }).format(v);
}
export function pct(v: number | null | undefined, digits = 1, signed = true): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return (signed && v > 0 ? "+" : "") + nf(`p${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v) + " %";
}
export function compact(v: number | null | undefined, currency?: string): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const s = nf("c", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  return currency ? `${s} ${currency}` : s;
}
export function dateDe(iso: string | Date | null | undefined): string {
  if (!iso) return "–";
  const s = typeof iso === "string" ? iso.slice(0, 10) : iso.toISOString().slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}.${m}.${y}` : s;
}
/** Zeitstempel mit expliziter Zeitzone. */
/** Zweite Zeitzone neben Berlin: New York (Zeit der US-Börsen). */
export const US_TZ = "America/New_York";

/** „13.10.2026, 18:05 MESZ · 12:05 ET“ – bei abweichendem Kalendertag in New York mit Datum („· 12.10., 23:30 ET“). */
export function dateTimeDe(d: Date | string | null | undefined, tz = "Europe/Berlin", secondTz: string | null = US_TZ): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "–";
  const main = new Intl.DateTimeFormat("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date);
  if (!secondTz || secondTz === tz) return main;
  const dayKey = (z: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const time = new Intl.DateTimeFormat("de-DE", { timeZone: secondTz, hour: "2-digit", minute: "2-digit" }).format(date);
  const day = dayKey(secondTz) !== dayKey(tz) ? `${new Intl.DateTimeFormat("de-DE", { timeZone: secondTz, day: "2-digit", month: "2-digit" }).format(date)}, ` : "";
  return `${main} · ${day}${time} ${secondTz === US_TZ ? "ET" : secondTz}`;
}
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
