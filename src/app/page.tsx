import { displayFx } from "@/lib/server/data";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadPortfolio } from "@/lib/server/portfolio";
import { marketOverview } from "@/lib/server/market";
import { assessFreshness } from "@/lib/data/quality";
import { Card, PageHeader, Stat, DemoBanner, Badge, DataBadge, Empty, Disclaimer, Table } from "@/components/ui";
import { ShareBars } from "@/components/charts";
import { moneyDual, pct, dateDe, dateTimeDe, num } from "@/lib/format";
import { modifiedDietz, holdingsAt } from "@/lib/calc/portfolio";
import { FxTable } from "@/lib/calc/fx";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { STOCK: "Aktien", ETF: "ETFs", CRYPTO: "Krypto", INDEX_PROXY: "Index-ETF", OTHER: "Sonstige", CASH: "Liquidität" };

export default async function Overview() {
  // Euro-Beträge mit Dollarwert daneben (Kurs: displayFx, Quelle in der Fußzeile)
  const fx = await displayFx();
  const money = (v: number | null | undefined, c: string, d?: number) => moneyDual(v, c, fx, d);
  const [pf, mk] = await Promise.all([loadPortfolio(), marketOverview()]);
  const r = pf.result;
  const base = pf.base;
  const open = r.positions.filter((p) => p.qty > 1e-10);
  const total = r.totalBase;
  const earnings = await prisma.earningsEvent.findMany({ where: { reportDate: { gte: new Date(pf.today + "T00:00:00Z") }, instrument: { OR: [{ onWatchlist: true }, { transactions: { some: {} } }] } }, include: { instrument: true }, orderBy: { reportDate: "asc" }, take: 6 });
  const lastFetch = await prisma.fetchLog.findFirst({ orderBy: { startedAt: "desc" } });
  const failed = await prisma.fetchLog.count({ where: { status: "FAILED", startedAt: { gte: new Date(Date.now() - 86400000) } } });

  // Performance (Modified Dietz) über Zeiträume – nur wenn Kurse zu beiden Stichtagen vorliegen
  const txs = (await prisma.transaction.findMany()).map((t) => ({ id: t.id, instrumentId: t.instrumentId, side: t.side, tradeDate: t.tradeDate.toISOString().slice(0, 10), quantity: t.quantity, price: t.price, priceCurrency: t.priceCurrency, fees: t.fees, fxToBase: t.fxToBase }));
  const bars = await prisma.priceBar.findMany({ where: { instrumentId: { in: open.map((p) => p.instrument.id) } }, orderBy: { date: "asc" }, select: { instrumentId: true, date: true, close: true, currency: true } });
  const fxt = new FxTable(pf.fxRates);
  const fxNow = (cur: string) => fxt.rate(cur, base)?.rate ?? null;
  // Rendite nur, wenn zum Endstichtag neuere Kurse vorliegen als zum Startstichtag (sonst wäre „0 %“ vorgetäuscht)
  let maxBarDate = "";
  const valueAt = (d: string) => {
    let v = 0;
    for (const [id, q] of holdingsAt(txs, d)) {
      if (q <= 1e-10) continue;
      const b = bars.filter((x) => x.instrumentId === id && x.date.toISOString().slice(0, 10) <= d).at(-1);
      if (!b) return null;
      const bd = b.date.toISOString().slice(0, 10);
      if (bd > maxBarDate) maxBarDate = bd;
      const fx = fxNow(b.currency);
      if (fx == null) return null;
      v += q * b.close * fx;
    }
    return v;
  };
  const back = (days: number) => { const d = new Date(pf.today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
  const perf = [["1 Tag", 1], ["1 Monat", 30], ["Lfd. Jahr", null], ["1 Jahr", 365]].map(([label, days]) => {
    const start = days == null ? `${pf.today.slice(0, 4)}-01-01` : back(days as number);
    maxBarDate = "";
    const s0 = valueAt(start);
    const startMax = maxBarDate;
    maxBarDate = "";
    const r0 = open.length && s0 != null ? modifiedDietz(txs, base, start, pf.today, valueAt) : null;
    return { label: label as string, r: r0 && maxBarDate > startMax ? r0 : null };
  });

  const alloc = Object.entries(r.byAssetType).map(([k, v]) => ({ label: TYPE_LABEL[k] ?? k, value: v, pct: total > 0 ? (v / total) * 100 : 0 })).sort((a, b) => b.value - a.value);
  const posAlloc = open.filter((p) => p.valueBase != null).map((p) => ({ label: p.instrument.symbol, value: p.valueBase!, pct: p.weightPct ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div>
      {pf.hasDemo && <DemoBanner />}
      <PageHeader title="Übersicht" subtitle={<>Stand {dateDe(pf.today)} · Basiswährung {base} · Kurse sind Schlusskurse mit ausgewiesenem Datenstand.</>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Vermögen">
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Gesamtvermögen" value={money(total, base)} sub={r.missingValue.length ? `ohne ${r.missingValue.join(", ")} (Kurs/FX fehlt)` : "inkl. Liquidität"} />
            <Stat label="Liquidität" value={money(pf.cash.base, base)} sub={r.cashQuotaPct != null ? `Cashquote ${pct(r.cashQuotaPct, 1, false)} (Ziel ${pct(mk.cfg.referenceCashQuotaPct, 0, false)} Referenz)` : "keine Cashbewegungen erfasst"} />
            <Stat label="Unrealisiert" value={money(r.unrealizedBase, base)} tone={r.unrealizedBase > 0 ? "good" : r.unrealizedBase < 0 ? "bad" : null} sub={r.costBaseTotal ? pct((r.unrealizedBase / r.costBaseTotal) * 100) : undefined} />
            <Stat label="Realisiert / Dividenden" value={money(r.realizedBase, base)} sub={`Dividenden ${money(r.dividendsBase, base)} · Gebühren ${money(r.feesBase, base)}`} />
          </div>
        </Card>
        <Card title="Entwicklung (Modified Dietz)">
          <ul className="space-y-1.5">
            {perf.map((p) => (
              <li key={p.label} className="flex justify-between"><span className="text-ink-2">{p.label}</span>{p.r ? <span className={p.r.returnPct >= 0 ? "text-good" : "text-bad"}>{pct(p.r.returnPct, 2)}</span> : <span className="text-ink-3" title="Kurse zu Beginn oder Ende fehlen">nicht berechenbar</span>}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">Investierter Teil in {base}, Bewertung mit aktuellem Wechselkurs; Tag/Monat nur mit Tageskursen aussagekräftig. Gesamtentwicklung: siehe unrealisiert + realisiert.</p>
        </Card>
        <Card title="Aufteilung">
          {alloc.length ? <ShareBars rows={alloc} /> : <Empty>Noch keine bewerteten Positionen.</Empty>}
          {posAlloc.length > 0 && <div className="mt-4"><ShareBars rows={posAlloc} /></div>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Marktlage" actions={<Link href="/markt" className="text-xs text-accent">Details →</Link>}>
          <ul className="space-y-2 text-sm">
            {mk.indices.map((i) => (
              <li key={i.symbol} className="flex flex-wrap items-center justify-between gap-2">
                <span>{i.label} <span className="text-ink-3">({i.symbol})</span></span>
                {i.available ? <span className="flex items-center gap-2">{i.stage?.stage ? <Badge tone={i.stage.stage === 2 ? "good" : i.stage.stage === 4 ? "bad" : "warn"}>{i.stage.label}</Badge> : null}<span className="text-ink-2">{pct(i.drawdownPct)} v. Hoch</span></span> : <Badge tone="bad">keine Daten</Badge>}
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-line pt-2 text-sm">
            Marktbreite: {mk.breadth.current.pctAbove != null ? <>{pct(mk.breadth.current.pctAbove, 0, false)} über SMA200 ({mk.breadth.current.evaluated} Titel){!mk.breadth.representative && <Badge tone="warn">nicht repräsentativ</Badge>}</> : <Badge tone="bad">nicht auswertbar – Universum ohne ausreichende Tageskurse</Badge>}
          </div>
          {mk.ruleA.triggered && <p className="mt-2"><Badge tone="warn">Regel A: schwache Marktbreite nahe Hoch – selektiver kaufen, ca. 15 % Cash als Orientierung prüfen</Badge></p>}
          {mk.ruleA.pullback && <p className="mt-2"><Badge tone="info">Regel A: Rücksetzer ≥ {mk.cfg.marketPullbackPct} % – schrittweisen Einsatz geplanter Liquidität prüfen</Badge></p>}
        </Card>
        <Card title="Zinsen & Makro">
          <ul className="space-y-1.5">
            {mk.cards.filter((c) => ["us10y", "effr", "eurusd", "wti", "gold"].includes(c.id)).map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-ink-2">{c.title}</span>
                {c.last ? <span className="flex items-center gap-2">{num(c.last.value, c.id === "eurusd" ? 4 : 2)} {c.unitLabel}<DataBadge f={assessFreshness({ dataDate: c.last.date, fetchedAt: c.series?.fetchedAt ?? null, frequency: "daily", today: pf.today, isSnapshot: c.series?.isSnapshot })} provider={c.series?.provider} /></span> : <Badge tone="bad">fehlt</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-2">Nächste FOMC-Entscheidung: {mk.fomc[0] ? dateDe(mk.fomc[0].end) : "–"} (14:00 ET, statischer Kalender – gegenprüfen)</p>
        </Card>
        <Card title="Termine & Datenstatus">
          {earnings.length ? (
            <ul className="space-y-1 text-sm">{earnings.map((e) => <li key={e.id} className="flex justify-between"><Link href={`/asset/${e.instrument.symbol}`} className="text-accent">{e.instrument.symbol}</Link><span>{dateDe(e.reportDate)} {e.dateIsEstimated && <Badge tone="warn">Termin geschätzt</Badge>}</span></li>)}</ul>
          ) : <Empty>Keine Quartalstermine abgerufen.</Empty>}
          <div className="mt-3 border-t border-line pt-2 text-xs text-ink-2">
            Letzter Abruf: {lastFetch ? `${dateTimeDe(lastFetch.startedAt)} (${lastFetch.providerId}, ${lastFetch.status})` : "noch keiner"}
            {failed > 0 && <div className="mt-1"><Badge tone="bad">{failed} fehlgeschlagene Abrufe in 24 h</Badge> <Link href="/einstellungen#protokoll" className="text-accent">Protokoll</Link></div>}
          </div>
        </Card>
      </div>

      {(r.warnings.length > 0 || pf.cash.missingFx.length > 0) && (
        <Card title="Risiko- und Datenhinweise" className="mt-4">
          <ul className="list-inside list-disc space-y-1 text-sm text-ink-2">
            {r.warnings.map((w) => <li key={w}>{w}</li>)}
            {pf.cash.missingFx.length > 0 && <li>Cash in {pf.cash.missingFx.join(", ")} ohne Wechselkurs – nicht in Summe enthalten</li>}
            {r.concentration.top1Pct != null && r.concentration.top1Pct > 25 && <li>Klumpenrisiko: größte Position {r.concentration.largest} mit {pct(r.concentration.top1Pct, 1, false)}</li>}
          </ul>
        </Card>
      )}

      <Card title="Positionen" className="mt-4" actions={<Link href="/portfolio" className="text-xs text-accent">Portfolio →</Link>}>
        {open.length ? (
          <Table head={["Wert", "Kurs", "Datenstand", "Wert " + base, "Anteil", "G/V " + base]}>
            {open.map((p) => (
              <tr key={p.instrument.id}>
                <td><Link className="text-accent" href={`/asset/${p.instrument.symbol}`}>{p.instrument.symbol}</Link> <span className="text-ink-3">{p.instrument.name}</span></td>
                <td className="num">{p.price ? money(p.price.price, p.price.currency) : "–"}</td>
                <td>{p.price ? <DataBadge f={assessFreshness({ dataDate: p.price.asOf, fetchedAt: pf.prices.get(p.instrument.id)?.fetchedAt ?? null, frequency: pf.prices.get(p.instrument.id)?.interval === "WEEK" ? "weekly" : "daily", today: pf.today, isDemo: p.price.isDemo, isSnapshot: pf.prices.get(p.instrument.id)?.isSnapshot })} provider={p.price.source} /> : <Badge tone="bad">Kurs fehlt</Badge>}</td>
                <td className="num">{money(p.valueBase, base)}</td>
                <td className="num">{pct(p.weightPct, 1, false)}</td>
                <td className={"num " + ((p.unrealizedBase ?? 0) >= 0 ? "text-good" : "text-bad")}>{money(p.unrealizedBase, base)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Noch keine Positionen. <Link href="/portfolio" className="text-accent">Buchung erfassen oder importieren</Link>.</Empty>}
      </Card>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
