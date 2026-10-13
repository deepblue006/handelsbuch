import { prisma } from "@/lib/db";
import { dedupeFlows, aggregateFlows, findGaps, type FlowRow } from "@/lib/flows/flows";
import { Card, PageHeader, Badge, Empty, Table, Field, Disclaimer } from "@/components/ui";
import { LinesChart, SignedBars } from "@/components/charts";
import { ActionForm } from "@/components/forms";
import { importFlows } from "@/app/actions";
import { num, dateDe, dateTimeDe } from "@/lib/format";

export const dynamic = "force-dynamic";
const PRIORITY = ["farside", "sosovalue", "manual"];

export default async function Flows({ searchParams }: { searchParams: Promise<{ by?: string; cls?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const by = sp.by === "fundTicker" ? "fundTicker" : "assetClass";
  const all = await prisma.fundFlow.findMany({ orderBy: { date: "asc" } });
  const classes = [...new Set(all.map((f) => f.assetClass))].sort();
  const cls = sp.cls && classes.includes(sp.cls) ? sp.cls : classes[0];
  const rows: FlowRow[] = all.filter((f) => !cls || f.assetClass === cls).map((f) => ({ fundTicker: f.fundTicker, issuer: f.issuer, assetClass: f.assetClass, date: f.date.toISOString().slice(0, 10), netFlow: f.netFlow, flowUnit: "USD_MILLION", aum: f.aum, volume: f.volume, closePrice: f.closePrice, status: f.status as FlowRow["status"], provider: f.provider }));
  const dd = dedupeFlows(rows, PRIORITY);
  const agg = aggregateFlows(dd, by, sp.from, sp.to);
  const gaps = findGaps(agg.series.map((s) => String(s.date)));
  const conflicts = dd.filter((d) => d.maxDeviation != null && d.maxDeviation > 0.05);
  const lastFetch = all.reduce<Date | null>((m, f) => (!m || f.fetchedAt > m ? f.fetchedAt : m), null);
  const totalKey = agg.groups.length === 1 ? agg.groups[0]! : null;

  return (
    <div>
      <PageHeader title="ETF- & ETP-Flows" subtitle="Tägliche Nettoflüsse und kumulierte Flüsse. AUM, Volumen und Kursveränderungen werden nur separat angezeigt und nie als Ersatz für Flüsse verwendet. Korrelationen zeigen keine Kausalität." />
      <Card title="Quellenstatus">
        <ul className="text-xs text-ink-2">
          <li><b>Farside Investors</b> – Website ohne API; Werte laut Farside geschätzt („Fokus auf Geschwindigkeit statt Genauigkeit“). Automatischer Abruf nicht implementiert (Weitergabebedingungen ungeklärt) → Tabelle unten einfügen.</li>
          <li><b>SoSoValue</b> – offizielle API-Doku nicht verifizierbar; kein Adapter (keine erfundenen Endpunkte).</li>
          <li><b>DefiLlama ETFs</b> – ETF-Endpunkt nicht dokumentiert auffindbar; kein Adapter.</li>
        </ul>
        <p className="mt-1 text-xs">Datenstand: {all.length ? `${all.length} Tageswerte, letzter Import ${dateTimeDe(lastFetch)}` : "keine Daten"} · Priorität bei Mehrfachquellen: {PRIORITY.join(" > ")}</p>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Ansicht" className="xl:col-span-1">
          <form className="grid grid-cols-2 gap-2">
            <Field label="Anlageklasse"><select name="cls" defaultValue={cls}>{classes.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Gruppierung"><select name="by" defaultValue={by}><option value="assetClass">Anlageklasse</option><option value="fundTicker">ETF-Ticker</option></select></Field>
            <Field label="von"><input type="date" name="from" defaultValue={sp.from} /></Field>
            <Field label="bis"><input type="date" name="to" defaultValue={sp.to} /></Field>
            <button className="col-span-2 rounded-md border border-line py-1 text-sm">Anwenden</button>
          </form>
          <div className="mt-3 text-sm">
            <b>Kumuliert im Zeitraum</b> ({dateDe(agg.coverage.from)}–{dateDe(agg.coverage.to)}, {agg.coverage.days} Tage):
            <ul className="mt-1 text-xs">{Object.entries(agg.totals).map(([k, v]) => <li key={k}>{k}: {num(v, 1)} Mio. USD</li>)}</ul>
          </div>
          {gaps.length > 0 && <p className="mt-2"><Badge tone="warn">{gaps.length} Werktage ohne Daten (Feiertage nicht erkannt)</Badge></p>}
          {conflicts.length > 0 && <p className="mt-2"><Badge tone="warn">{conflicts.length} Werte mit abweichenden Quellen – priorisierte Quelle gezeigt</Badge></p>}
        </Card>
        <Card title={`Tägliche Nettoflüsse${cls ? ` – ${cls}` : ""}`} className="xl:col-span-2">
          {agg.series.length ? (
            <>
              {totalKey ? <SignedBars data={agg.series} dataKey={totalKey} label={`Nettofluss ${totalKey}`} unit="Mio. USD" /> : <LinesChart data={agg.series} series={agg.groups.slice(0, 8).map((g, i) => ({ key: g, label: g, color: `var(--s${i + 1})` }))} />}
              <h3 className="mt-3 text-xs font-semibold text-ink-2">Kumuliert</h3>
              <LinesChart height={180} data={agg.series} series={agg.groups.slice(0, 8).map((g, i) => ({ key: `${g}_kum`, label: `${g} kumuliert`, color: `var(--s${i + 1})` }))} />
            </>
          ) : <Empty>Noch keine Flussdaten importiert.</Empty>}
        </Card>
      </div>

      <Card title="Flusstabelle importieren (z. B. von Farside kopiert)" className="mt-4">
        <ActionForm action={importFlows} submit="Importieren" className="grid gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Quelle"><select name="provider"><option value="farside">Farside Investors</option><option value="sosovalue">SoSoValue</option><option value="manual">Manuell</option></select></Field>
            <Field label="Anlageklasse"><input name="assetClass" defaultValue="BTC" /></Field>
          </div>
          <Field label="Tabelle (erste Spalte Datum, weitere Spalten je Fonds; Werte in Mio. USD; „(12,3)“ = Abfluss, „-“ = kein Wert)"><textarea name="table" rows={6} className="font-mono text-xs" placeholder={"Date\tIBIT\tFBTC\tTotal\n09 Oct 2026\t120.4\t(15.2)\t105.2"} /></Field>
        </ActionForm>
        <p className="mt-2 text-[11px] text-ink-3">Die Spalte „Total“ und Summenzeilen werden nicht importiert (keine Doppelzählung). Erneuter Import desselben Tages überschreibt den Wert und markiert ihn als „REVIDIERT“.</p>
      </Card>

      {dd.length > 0 && (
        <Card title="Einzelwerte" className="mt-4">
          <Table head={["Datum", "Fonds", "Nettofluss (Mio. USD)", "AUM (separat)", "Status", "Quelle", "Abweichung andere Quellen"]}>
            {dd.slice(-60).reverse().map((d) => <tr key={d.fundTicker + d.date}><td>{dateDe(d.date)}</td><td>{d.fundTicker}</td><td className={"num " + ((d.netFlow ?? 0) >= 0 ? "text-good" : "text-bad")}>{num(d.netFlow, 1)}</td><td className="num">{d.aum != null ? num(d.aum, 0) : "–"}</td><td>{d.status}</td><td>{d.provider}</td><td className="num">{d.maxDeviation != null ? num(d.maxDeviation, 1) : "–"}</td></tr>)}
          </Table>
        </Card>
      )}
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
