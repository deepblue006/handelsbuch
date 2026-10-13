/**
 * Simulationen ohne Orders: Rücksetzerszenarien und hypothetische Käufe.
 */
export interface SimPosition { symbol: string; valueBase: number; tags: string[] }

export interface ShockResult { symbol: string; before: number; after: number; changePct: number }

/** Wendet prozentuale Schocks an: allgemeiner Marktschock und optional gezielter Schock für getaggte Positionen. */
export function shockScenario(positions: SimPosition[], cashBase: number, marketShockPct: number, tagged?: { tag: string; shockPct: number }) {
  const rows: ShockResult[] = positions.map((p) => {
    const s = tagged && p.tags.includes(tagged.tag) ? tagged.shockPct : marketShockPct;
    return { symbol: p.symbol, before: p.valueBase, after: p.valueBase * (1 + s / 100), changePct: s };
  });
  const before = rows.reduce((s, r) => s + r.before, 0) + cashBase;
  const after = rows.reduce((s, r) => s + r.after, 0) + cashBase;
  return { rows, totalBefore: before, totalAfter: after, changePct: before > 0 ? ((after - before) / before) * 100 : 0, cashQuotaAfter: after > 0 ? (cashBase / after) * 100 : null };
}

/** Hypothetischer Kauf aus Liquidität: neue Gewichte und Cashquote. */
export function simulateBuy(positions: SimPosition[], cashBase: number, symbol: string, amount: number) {
  if (!(amount > 0)) throw new Error("Betrag muss > 0 sein");
  if (amount > cashBase + 1e-9) throw new Error("Betrag übersteigt die verfügbare Liquidität");
  const map = new Map(positions.map((p) => [p.symbol, p.valueBase]));
  map.set(symbol, (map.get(symbol) ?? 0) + amount);
  const cash = cashBase - amount;
  const total = [...map.values()].reduce((s, v) => s + v, 0) + cash;
  return {
    weights: [...map.entries()].map(([s, v]) => ({ symbol: s, weightPct: total > 0 ? (v / total) * 100 : 0 })).sort((a, b) => b.weightPct - a.weightPct),
    cashAfter: cash,
    cashQuotaAfter: total > 0 ? (cash / total) * 100 : 0,
    total,
  };
}

/** Nächste Ausführungstermine eines Sparplans ab einem Datum. */
export function nextPlanDates(startDate: string, dayOfMonth: number, interval: "MONTHLY" | "QUARTERLY", from: string, count = 3): string[] {
  const out: string[] = [];
  const step = interval === "MONTHLY" ? 1 : 3;
  const s = new Date(startDate + "T00:00:00Z");
  let y = s.getUTCFullYear(), m = s.getUTCMonth();
  for (let guard = 0; out.length < count && guard < 600; guard++) {
    const d = new Date(Date.UTC(y, m, Math.min(dayOfMonth, 28))).toISOString().slice(0, 10);
    if (d >= from && d >= startDate) out.push(d);
    m += step;
    if (m > 11) { y += Math.floor(m / 12); m %= 12; }
  }
  return out;
}
