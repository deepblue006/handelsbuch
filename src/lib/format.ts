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
export function dateTimeDe(d: Date | string | null | undefined, tz = "Europe/Berlin"): string {
  if (!d) return "–";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("de-DE", { timeZone: tz, dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(date);
}
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
