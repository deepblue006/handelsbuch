import type { ReactNode } from "react";
import { STATE_LABEL, type DataState, type Freshness } from "@/lib/data/quality";
import { dateDe, dateTimeDe } from "@/lib/format";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className, actions, id }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={cn("rounded-lg border border-line bg-surface p-4", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE: Record<string, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  good: "border-[color:var(--good)]/40 text-good bg-[color:var(--good)]/10",
  warn: "border-[color:var(--warn)]/50 text-warn bg-[color:var(--warn)]/10",
  bad: "border-[color:var(--bad)]/40 text-bad bg-[color:var(--bad)]/10",
  info: "border-[color:var(--accent)]/40 text-accent bg-[color:var(--accent)]/10",
};
const ICON: Record<string, string> = { good: "●", warn: "▲", bad: "■", info: "◆", neutral: "○" };

/** Statusanzeige immer mit Symbol + Text, nie Farbe allein. */
export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof TONE; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-4", TONE[tone])}>
      <span aria-hidden>{ICON[tone]}</span>
      {children}
    </span>
  );
}

const STATE_TONE: Record<DataState, keyof typeof TONE> = {
  AKTUELL: "good", VERZÖGERT: "info", ZWISCHENGESPEICHERT: "warn", VERALTET: "bad", SNAPSHOT: "info",
  HISTORISCH: "neutral", GESCHÄTZT: "warn", MANUELL: "neutral", DEMO: "bad", FEHLT: "bad",
};

export function DataBadge({ f, provider }: { f: Freshness; provider?: string | null }) {
  const t = [f.explanation, f.dataDate ? `Datenstand: ${dateDe(f.dataDate)}` : null, f.fetchedAt ? `Abruf: ${dateTimeDe(f.fetchedAt)}` : null, provider ? `Quelle: ${provider}` : null].filter(Boolean).join(" · ");
  return <Badge tone={STATE_TONE[f.state]} title={t}>{STATE_LABEL[f.state]}{f.dataDate && f.state !== "FEHLT" ? ` · ${dateDe(f.dataDate)}` : ""}</Badge>;
}

/** Herkunftszeile unter Kennzahlen: Quelle, Datenstand, Abrufzeit. */
export function SourceLine({ provider, dataDate, fetchedAt, extra }: { provider?: string | null; dataDate?: string | null; fetchedAt?: Date | string | null; extra?: ReactNode }) {
  return (
    <p className="mt-2 text-[11px] leading-4 text-ink-3">
      Quelle: {provider ?? "–"} · Datenstand: {dateDe(dataDate ?? null)} · Abruf: {dateTimeDe(fetchedAt ?? null)}
      {extra ? <> · {extra}</> : null}
    </p>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div role="alert" className="mb-4 rounded-md border-2 border-[color:var(--demo)] bg-[color:var(--bad)]/10 px-3 py-2 text-sm font-semibold text-bad">
      ■ DEMODATEN AKTIV – Teile des Portfolios sind synthetische Beispieldaten und keine echten Bestände. Entfernen: <code>npm run db:seed:demo -- --remove</code>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-line p-4 text-sm text-ink-2">{children}</div>;
}

export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-ink-3" title="Daten fehlen – nicht geschätzt">{children}</span>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-3">
            {head.map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line/60 [&>tr:last-child]:border-0 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function Button({ children, variant = "primary", type = "submit", ...rest }: { children: ReactNode; variant?: "primary" | "ghost" | "danger"; type?: "submit" | "button"; name?: string; value?: string; formAction?: never }) {
  const cls = variant === "primary" ? "bg-accent text-white hover:opacity-90" : variant === "danger" ? "border border-[color:var(--bad)]/40 text-bad hover:bg-[color:var(--bad)]/10" : "border border-line text-ink hover:bg-surface-2";
  return <button type={type} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", cls)} {...rest}>{children}</button>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-2">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Disclaimer() {
  return <p className="text-[11px] text-ink-3">Analyse- und Entscheidungshilfe – keine Anlageberatung, keine automatische Orderausführung. Referenzregeln aus der Zusammenstellung „Marktdaten, die Finanzwiesel nutzt“ (Stand 11.10.2026) sind Startparameter, keine Garantie.</p>;
}
