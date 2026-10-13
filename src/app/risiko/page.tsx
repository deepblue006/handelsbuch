import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadPortfolio } from "@/lib/server/portfolio";
import { analyzeAsset } from "@/lib/server/analysis";
import { Card, PageHeader, Badge, Empty, Table, DemoBanner, Disclaimer } from "@/components/ui";
import { ShareBars } from "@/components/charts";
import { pct, dateDe, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Risiko() {
  const pf = await loadPortfolio();
  const open = pf.result.positions.filter((p) => p.qty > 1e-10);
  const analyses = (await Promise.all(open.map((p) => analyzeAsset(p.instrument.symbol)))).filter((x): x is NonNullable<typeof x> => !!x);
  const events = await prisma.thesisEvent.findMany({ include: { instrument: true }, orderBy: { date: "desc" }, take: 30 });
  const total = pf.result.totalBase;
  const sectors = Object.entries(pf.result.bySector).map(([label, v]) => ({ label, value: v, pct: total > 0 ? (v / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
  return (
    <div>
      {pf.hasDemo && <DemoBanner />}
      <PageHeader title="Risiko- und Thesenverwaltung" subtitle="Thesen, These-Verletzungen, Bewertungs- und Konzentrationsrisiken sowie anstehende Ereignisse je Position. Regeln und Schwellen sind unter „Einstellungen“ editierbar." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Konzentration nach Sektor">{sectors.length ? <ShareBars rows={sectors} /> : <Empty>Keine Positionen.</Empty>}<p className="mt-2 text-xs text-ink-2">Größte Position {pf.result.concentration.largest ?? "–"} ({pct(pf.result.concentration.top1Pct, 1, false)}), Top 3 {pct(pf.result.concentration.top3Pct, 1, false)}.</p></Card>
        <Card title="Thesen-Ereignisse" className="xl:col-span-2">
          {events.length ? <ul className="text-xs">{events.map((e) => <li key={e.id} className="border-b border-line py-1">{dateDe(e.date)} · <Link href={`/asset/${e.instrument.symbol}`} className="text-accent">{e.instrument.symbol}</Link> · {e.kind === "THESE_VERLETZT" ? <Badge tone="bad">These verletzt</Badge> : e.kind} · {e.text}</li>)}</ul> : <Empty>Noch keine Einträge – auf der Detailseite je Asset erfassen.</Empty>}
        </Card>
      </div>
      <Card title="Positionen: These, Bewertung, Ereignisse, Prüfsignale" className="mt-4">
        {analyses.length ? (
          <Table head={["Wert", "These", "Status", "Gewicht / Max.", "Bewertung", "Nächstes Ereignis", "Ausgelöste Prüfungen", "Handlungsoption (prüfen)"]}>
            {analyses.map((a) => {
              const fired = a.rules.outcomes.filter((o) => o.status === "AUSGELÖST");
              const option = a.inst.meta?.thesisStatus === "VERLETZT" ? "Halten/Reduzieren prüfen" : fired.some((o) => o.id === "B4_RULE_OF_20") ? "Rule of 20 durchgehen" : fired.some((o) => o.id === "B3_NACHKAUFMARKE") ? "Nachkauf prüfen (These zuerst)" : a.inst.meta?.preference === "HOLD_ONLY" ? "Halten (Präferenz)" : "Halten";
              return (
                <tr key={a.inst.id}>
                  <td><Link href={`/asset/${a.inst.symbol}`} className="text-accent">{a.inst.symbol}</Link></td>
                  <td className="max-w-64 text-xs">{a.inst.meta?.thesis ?? <span className="text-ink-3">keine These erfasst</span>}</td>
                  <td>{a.inst.meta?.thesisStatus ? <Badge tone={a.inst.meta.thesisStatus === "INTAKT" ? "good" : a.inst.meta.thesisStatus === "VERLETZT" ? "bad" : "warn"}>{a.inst.meta.thesisStatus}</Badge> : <Badge>nicht bewertet</Badge>}</td>
                  <td className="num">{pct(a.position?.weightPct, 1, false)} / {pct(a.inst.meta?.maxWeightPct ?? a.general.maxPositionWeightPct, 0, false)}</td>
                  <td className="text-xs">{a.valuation.fairValueBase != null && a.price != null ? (a.price > a.valuation.fairValueBase ? <Badge tone="warn">über Fair Value ({money(a.valuation.fairValueBase, a.inst.currency)})</Badge> : <Badge tone="good">unter Fair Value</Badge>) : <span className="text-ink-3">kein Modell</span>}</td>
                  <td className="text-xs">{a.earnings[0] ? `Zahlen ${dateDe(a.earnings[0].reportDate)}` : "–"}</td>
                  <td className="text-xs">{fired.map((o) => <div key={o.id}>{o.direction === "CONTRA" ? "■" : o.direction === "PRO" ? "●" : "▲"} {o.title}</div>)}</td>
                  <td className="text-xs">{option}</td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>Keine offenen Positionen.</Empty>}
        <p className="mt-2 text-[11px] text-ink-3">„Handlungsoption“ ist ein Prüfhinweis aus den hinterlegten Regeln, keine Empfehlung. Ein prozentualer Verlust allein ist nie ein ausreichender Grund für einen Nachkauf.</p>
      </Card>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
