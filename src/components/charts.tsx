"use client";
/**
 * Diagramme (Recharts). Grundsätze: eine Y-Achse je Diagramm, dünne Linien, Legende ab zwei Reihen,
 * Tooltip mit deutscher Formatierung, Farben über CSS-Variablen (hell/dunkel).
 */
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend, BarChart, Bar, Cell,
} from "recharts";

const de = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const fmtDate = (d: string) => { const [y, m, day] = d.split("-"); return `${day}.${m}.${y?.slice(2)}`; };
const axis = { stroke: "var(--ink-3)", fontSize: 11, tickLine: false } as const;
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 12, color: "var(--ink)" };

export interface SeriesDef { key: string; label: string; color: string; dashed?: boolean; width?: number }

export function LinesChart({ data, series, height = 260, yLabel, refLines = [], domain }: {
  data: Record<string, number | string | null>[];
  series: SeriesDef[];
  height?: number;
  yLabel?: string;
  refLines?: { y: number; label: string }[];
  domain?: [number | "auto", number | "auto"];
}) {
  if (!data.length) return <div className="flex h-24 items-center justify-center text-sm text-ink-3">Keine Datenpunkte</div>;
  return (
    <div style={{ height }} role="img" aria-label={`Liniendiagramm: ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" {...axis} tickFormatter={fmtDate} minTickGap={40} />
          <YAxis {...axis} width={58} domain={domain ?? ["auto", "auto"]} tickFormatter={(v) => de.format(v)} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: "var(--ink-3)", fontSize: 11 } : undefined} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDate(String(l))} formatter={(v, n) => [v == null ? "–" : de.format(Number(v)), n]} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--ink-2)" }} />}
          {refLines.map((r) => <ReferenceLine key={r.label} y={r.y} stroke="var(--ink-3)" strokeDasharray="4 4" label={{ value: r.label, fill: "var(--ink-3)", fontSize: 10, position: "right" }} />)}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tageswerte mit Vorzeichen: Zufluss blau, Abfluss rot (divergierende Pole). */
export function SignedBars({ data, dataKey, label, height = 220, unit }: { data: Record<string, number | string | null>[]; dataKey: string; label: string; height?: number; unit: string }) {
  if (!data.length) return <div className="flex h-24 items-center justify-center text-sm text-ink-3">Keine Datenpunkte</div>;
  return (
    <div style={{ height }} role="img" aria-label={`Balkendiagramm ${label}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="date" {...axis} tickFormatter={fmtDate} minTickGap={30} />
          <YAxis {...axis} width={58} tickFormatter={(v) => de.format(v)} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDate(String(l))} formatter={(v) => [`${de.format(Number(v))} ${unit}`, label]} />
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Bar dataKey={dataKey} name={label} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={Number(d[dataKey]) >= 0 ? "var(--s1)" : "var(--s8)"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontale Anteilsbalken mit Text-Labels (Identität nie nur über Farbe). */
export function ShareBars({ rows }: { rows: { label: string; value: number; pct: number }[] }) {
  if (!rows.length) return null;
  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => (
        <li key={r.label} className="text-xs">
          <div className="mb-0.5 flex justify-between gap-2"><span className="text-ink">{r.label}</span><span className="text-ink-2">{de.format(r.pct)} %</span></div>
          <div className="h-2 rounded bg-surface-2"><div className="h-2 rounded" style={{ width: `${Math.max(0, Math.min(100, r.pct))}%`, background: `var(--s${(i % 8) + 1})` }} /></div>
        </li>
      ))}
    </ul>
  );
}
