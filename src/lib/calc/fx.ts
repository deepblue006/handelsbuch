/**
 * Währungsumrechnung – transparent und ohne stille Annahmen.
 *
 * Kurse werden als Paar "BASEQUOTE" gespeichert: rate = Einheiten QUOTE je 1 Einheit BASE.
 * Beispiel: EURUSD = 1.12 → 1 EUR = 1,12 USD.
 * Fehlt ein Kurs, liefert die Umrechnung `null` – es wird niemals 1:1 angenommen.
 */

export interface FxRate {
  pair: string; // "EURUSD"
  rate: number;
  date: string; // Datenstand
  source: string;
}

export interface Conversion {
  value: number;
  rate: number; // Einheiten Ziel je 1 Einheit Quelle
  path: string; // z. B. "USD→EUR über EURUSD (invertiert)"
  date: string | null;
  source: string | null;
}

export class FxTable {
  private map = new Map<string, FxRate>();
  constructor(rates: FxRate[] = []) {
    for (const r of rates) this.add(r);
  }
  add(r: FxRate) {
    if (!(r.rate > 0)) throw new Error(`Ungültiger Wechselkurs ${r.pair}: ${r.rate}`);
    if (!/^[A-Z]{6}$/.test(r.pair)) throw new Error(`Ungültiges Währungspaar: ${r.pair}`);
    this.map.set(r.pair, r);
  }
  /** Einheiten `to` je 1 Einheit `from`, inkl. Herkunft. */
  private direct(from: string, to: string): Omit<Conversion, "value"> | null {
    if (from === to) return { rate: 1, path: "gleiche Währung", date: null, source: null };
    const d = this.map.get(from + to);
    if (d) return { rate: d.rate, path: `${from}→${to} über ${d.pair}`, date: d.date, source: d.source };
    const inv = this.map.get(to + from);
    if (inv) return { rate: 1 / inv.rate, path: `${from}→${to} über ${inv.pair} (invertiert)`, date: inv.date, source: inv.source };
    return null;
  }
  rate(from: string, to: string): Omit<Conversion, "value"> | null {
    from = from.toUpperCase();
    to = to.toUpperCase();
    const d = this.direct(from, to);
    if (d) return d;
    // Kreuzkurs über EUR oder USD (nur eine Stufe, keine Rekursion)
    for (const via of ["EUR", "USD"]) {
      if (via === from || via === to) continue;
      const a = this.direct(from, via);
      const b = a && this.direct(via, to);
      if (a && b) {
        const dates = [a.date, b.date].filter(Boolean) as string[];
        return {
          rate: a.rate * b.rate,
          path: `${from}→${via}→${to} (Kreuzkurs)`,
          date: dates.length ? dates.sort()[0]! : null, // ältester beteiligter Datenstand
          source: [a.source, b.source].filter(Boolean).join(" + ") || null,
        };
      }
    }
    return null;
  }
  convert(amount: number, from: string, to: string): Conversion | null {
    const r = this.rate(from, to);
    if (!r) return null;
    return { ...r, value: amount * r.rate };
  }
}

/**
 * Zerlegt die Rendite eines Fremdwährungsinvestments in Kurs- und Währungseffekt (in Basiswährung).
 * qty Stück, Einstand je Stück `costPx` in Handelswährung, historischer Basis-Einstand `costBase`,
 * aktueller Kurs `px` in Handelswährung, aktueller Kurs Basis je Handelswährung `fxNow`.
 */
export function decomposeReturn(qty: number, costPx: number, costBase: number, px: number, fxNow: number) {
  const valueBase = qty * px * fxNow;
  const priceEffect = qty * (px - costPx) * fxNow;
  const fxEffect = qty * costPx * fxNow - costBase;
  return { valueBase, priceEffect, fxEffect, total: valueBase - costBase };
}
