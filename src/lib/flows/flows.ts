/**
 * ETF-/ETP-Flows: Import, Deduplizierung, Kumulierung.
 * - Nettoflüsse sind echte gemeldete Flüsse. AUM, Volumen und Kursveränderung werden separat geführt
 *   und NIE als Ersatz für Flüsse verwendet.
 * - Liefern mehrere Quellen denselben Fonds am selben Tag, wird nach Priorität EIN Wert gewählt;
 *   die Abweichung zwischen Quellen wird ausgewiesen (keine Doppelzählung).
 */

export interface FlowRow {
  fundTicker: string;
  issuer: string | null;
  assetClass: string;
  date: string;
  netFlow: number | null; // in flowUnit
  flowUnit: "USD_MILLION";
  aum: number | null;
  volume: number | null;
  closePrice: number | null;
  status: "BESTÄTIGT" | "UNBESTÄTIGT" | "GESCHÄTZT" | "REVIDIERT";
  provider: string;
}

/** Zahl im Farside-Stil: "(12.3)" = −12,3; "-" oder leer = kein Wert; "0.0" = 0. */
export function parseFlowNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/,/g, "");
  if (s === "" || s === "-" || s === "–" || s.toLowerCase() === "n/a") return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "11 Jan 2024" | "2024-01-11" | "11.01.2024" → ISO */
export function parseFlowDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2]!.toLowerCase()]) return `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export interface ParseReport {
  rows: FlowRow[];
  skipped: { line: number; reason: string }[];
  tickers: string[];
}

/**
 * Breite Tabelle (wie Farside): erste Spalte Datum, weitere Spalten je Fonds, optional „Total“.
 * Trennzeichen: Tab, Semikolon oder Komma. Zeilen ohne gültiges Datum (Summen, Durchschnitte) werden übersprungen.
 * Die Spalte „Total“ wird NICHT als Fonds importiert (sonst Doppelzählung).
 */
export function parseWideFlowTable(text: string, opts: { assetClass: string; provider: string; status?: FlowRow["status"] }): ParseReport {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { rows: [], skipped: [], tickers: [] };
  const sep = lines[0]!.includes("\t") ? "\t" : lines[0]!.includes(";") ? ";" : ",";
  const header = lines[0]!.split(sep).map((h) => h.trim());
  const tickers = header.slice(1).filter((h) => h && !/^total$/i.test(h));
  const rows: FlowRow[] = [];
  const skipped: ParseReport["skipped"] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(sep);
    const date = parseFlowDate(cells[0] ?? "");
    if (!date) { skipped.push({ line: i + 1, reason: `kein Datum („${(cells[0] ?? "").trim()}“)` }); continue; }
    header.slice(1).forEach((h, j) => {
      if (!h || /^total$/i.test(h)) return;
      const v = parseFlowNumber(cells[j + 1]);
      if (v === null) return; // kein Wert ≠ 0
      rows.push({ fundTicker: h.toUpperCase(), issuer: null, assetClass: opts.assetClass, date, netFlow: v, flowUnit: "USD_MILLION", aum: null, volume: null, closePrice: null, status: opts.status ?? "UNBESTÄTIGT", provider: opts.provider });
    });
  }
  return { rows, skipped, tickers };
}

export interface DedupedFlow extends FlowRow {
  alternatives: { provider: string; netFlow: number | null }[];
  maxDeviation: number | null;
}

/** Ein Wert je Fonds und Tag nach Provider-Priorität (erste = höchste). */
export function dedupeFlows(rows: FlowRow[], priority: string[]): DedupedFlow[] {
  const rank = (p: string) => { const i = priority.indexOf(p); return i < 0 ? priority.length : i; };
  const groups = new Map<string, FlowRow[]>();
  for (const r of rows) {
    const k = `${r.fundTicker}|${r.date}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: DedupedFlow[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => rank(a.provider) - rank(b.provider));
    const chosen = g[0]!;
    const others = g.slice(1);
    const vals = g.map((x) => x.netFlow).filter((v): v is number => v != null);
    out.push({
      ...chosen,
      alternatives: others.map((o) => ({ provider: o.provider, netFlow: o.netFlow })),
      maxDeviation: vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : null,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.fundTicker.localeCompare(b.fundTicker)));
}

/** Tägliche Summe je Gruppe (Anlageklasse oder Fonds) und kumulierte Summe ab Startdatum. */
export function aggregateFlows(rows: FlowRow[], by: "assetClass" | "fundTicker", from?: string, to?: string) {
  const filtered = rows.filter((r) => r.netFlow != null && (!from || r.date >= from) && (!to || r.date <= to));
  const daily = new Map<string, Map<string, number>>();
  for (const r of filtered) {
    const key = r[by];
    const m = daily.get(r.date) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + r.netFlow!);
    daily.set(r.date, m);
  }
  const dates = [...daily.keys()].sort();
  const groups = [...new Set(filtered.map((r) => r[by]))].sort();
  const cum: Record<string, number> = {};
  return {
    groups,
    series: dates.map((d) => {
      const row: Record<string, number | string> = { date: d };
      for (const g of groups) {
        const v = daily.get(d)!.get(g) ?? 0;
        cum[g] = (cum[g] ?? 0) + v;
        row[g] = v;
        row[`${g}_kum`] = cum[g]!;
      }
      return row;
    }),
    totals: { ...cum },
    coverage: { from: dates[0] ?? null, to: dates.at(-1) ?? null, days: dates.length },
  };
}

/** Lücken: Werktage ohne Daten zwischen erstem und letztem Datum (Feiertage werden nicht erkannt). */
export function findGaps(dates: string[]): string[] {
  if (dates.length < 2) return [];
  const set = new Set(dates);
  const sorted = [...set].sort();
  const gaps: string[] = [];
  const d = new Date(sorted[0]! + "T00:00:00Z");
  const end = new Date(sorted.at(-1)! + "T00:00:00Z");
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !set.has(iso)) gaps.push(iso);
  }
  return gaps;
}

/** Pearson-Korrelation – rein beschreibend, keine Kausalität. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}
