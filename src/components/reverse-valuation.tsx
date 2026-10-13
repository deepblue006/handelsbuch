"use client";
import { useState } from "react";
import { reverseValuation } from "@/lib/calc/valuation";

const de = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "–" : new Intl.NumberFormat("de-DE", { maximumFractionDigits: d }).format(v));

/** Rückwärtsrechnung „Was steckt im Kurs?“ – alle Annahmen sichtbar und änderbar. */
export function ReverseValuation({ marketCap, revenue, currency }: { marketCap: number | null; revenue: number | null; currency: string }) {
  const [mc, setMc] = useState(marketCap ? String(Math.round(marketCap / 1e6)) : "");
  const [rev, setRev] = useState(revenue ? String(Math.round(revenue / 1e6)) : "");
  const [pe, setPe] = useState("25");
  const [margin, setMargin] = useState("20");
  const [g, setG] = useState("15");
  const [ret, setRet] = useState("");
  const [n, setN] = useState("");
  let out: ReturnType<typeof reverseValuation> | null = null;
  let err = "";
  try {
    if (mc && rev) out = reverseValuation({ marketCap: Number(mc) * 1e6, currentRevenue: Number(rev) * 1e6, targetPe: Number(pe), matureNetMarginPct: Number(margin), expectedGrowthPct: g ? Number(g) : undefined, requiredReturnPct: ret ? Number(ret) : undefined, horizonYears: n ? Number(n) : undefined });
  } catch (e) { err = (e as Error).message; }
  const inp = (label: string, v: string, set: (s: string) => void, hint?: string) => (
    <label className="flex flex-col gap-1 text-xs text-ink-2">{label}<input inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(",", "."))} />{hint && <span className="text-[11px] text-ink-3">{hint}</span>}</label>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {inp(`Börsenwert (Mio. ${currency})`, mc, setMc, marketCap ? "vorbelegt: Kurs × verwässerte Aktien (SEC)" : "manuell eingeben")}
        {inp(`Aktueller Umsatz (Mio. ${currency})`, rev, setRev, revenue ? "vorbelegt: letztes Geschäftsjahr (SEC)" : undefined)}
        {inp("Ziel-KGV bei Reife", pe, setPe)}
        {inp("Reife Nettomarge (%)", margin, setMargin)}
        {inp("Erwartetes Umsatzwachstum p. a. (%)", g, setG)}
        {inp("Gewünschte Rendite p. a. (%) – optional", ret, setRet)}
        {inp("Horizont (Jahre) – optional", n, setN)}
      </div>
      {err && <p className="text-xs text-bad">■ {err}</p>}
      {out && (
        <div className="rounded-md bg-surface-2 p-3 text-sm">
          <p>Nötiger Jahresgewinn: <b>{de(out.requiredNetIncome / 1e6, 0)} Mio. {currency}</b> → nötiger Umsatz: <b>{de(out.requiredRevenue / 1e6, 0)} Mio. {currency}</b> ({de(out.revenueMultiple, 2)}× heute).</p>
          <p className="mt-1">{out.yearsAtExpectedGrowth != null ? <>Bei {g} % Wachstum p. a. erreicht nach ca. <b>{de(out.yearsAtExpectedGrowth, 1)} Jahren</b>.</> : "Wachstumsannahme fehlt."} {out.impliedCagrForHorizon != null && <>Für {n} Jahre nötig: <b>{de(out.impliedCagrForHorizon, 1)} % Umsatzwachstum p. a.</b></>}</p>
          <p className="mt-2 text-[11px] text-ink-3">Formel: {out.formula}. Zeigt, welche Erwartungen im Kurs stecken könnten – keine Prognose.</p>
        </div>
      )}
    </div>
  );
}
