import { displayFx } from "@/lib/server/data";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadPortfolio } from "@/lib/server/portfolio";
import { assessFreshness } from "@/lib/data/quality";
import { Card, PageHeader, DemoBanner, Badge, DataBadge, Empty, Table, Field } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { CsvImport, LegacyImport } from "@/components/csv-import";
import { addTransaction, addCash, deleteTransaction, saveManualFx } from "@/app/actions";
import { moneyDual, pct, qty, dateDe, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  // Euro-Beträge mit Dollarwert daneben (Kurs: displayFx, Quelle in der Fußzeile)
  const fx = await displayFx();
  const money = (v: number | null | undefined, c: string, d?: number) => moneyDual(v, c, fx, d);
  const pf = await loadPortfolio();
  const r = pf.result;
  const base = pf.base;
  const txs = await prisma.transaction.findMany({ include: { instrument: true }, orderBy: [{ tradeDate: "desc" }, { seq: "desc" }], take: 200 });
  const cash = await prisma.cashMovement.findMany({ orderBy: { date: "desc" }, take: 50 });
  const plans = await prisma.savingsPlan.findMany({ include: { instrument: true } });
  const metas = await prisma.positionMeta.findMany();
  const metaBy = new Map(metas.map((m) => [m.instrumentId, m]));
  const open = r.positions.filter((p) => p.qty > 1e-10).sort((a, b) => (b.valueBase ?? 0) - (a.valueBase ?? 0));
  const realized = r.closedRealized.slice().reverse().slice(0, 30);
  const instById = new Map(r.positions.map((p) => [p.instrument.id, p.instrument]));

  return (
    <div>
      {pf.hasDemo && <DemoBanner />}
      <PageHeader title="Portfolio" subtitle={`Bestände nach FIFO in Handelswährung und ${base}. Einstand zum historischen Wechselkurs des Handelstags; Marktwert zum aktuellen Kurs. Kurs- und Währungseffekt getrennt.`} />

      <Card title="Bestand">
        {open.length ? (
          <Table head={["Wert", "Stück", "Ø Einstand", "Kurs (Handelswährung)", "Datenstand", `Marktwert ${base}`, "Anteil", `Kurseffekt`, `Währungseffekt`, "G/V gesamt", "Hinweise"]}>
            {open.map((p) => {
              const pi = pf.prices.get(p.instrument.id);
              const m = metaBy.get(p.instrument.id);
              return (
                <tr key={p.instrument.id}>
                  <td><Link href={`/asset/${p.instrument.symbol}`} className="font-medium text-accent">{p.instrument.symbol}</Link><div className="text-xs text-ink-3">{p.instrument.name} · {p.instrument.assetType}{m?.preference === "HOLD_ONLY" && <> · <Badge tone="info" title={m.preferenceNote ?? ""}>Präferenz: nur halten</Badge></>}</div></td>
                  <td className="num">{qty(p.qty)}</td>
                  <td className="num">{money(p.avgCostCcy, p.instrument.currency)}</td>
                  <td className="num">{p.price ? money(p.price.price, p.price.currency) : <Badge tone="bad">fehlt</Badge>}{p.vsCostPct != null && <div className={"text-xs " + (p.vsCostPct >= 0 ? "text-good" : "text-bad")}>{pct(p.vsCostPct)} z. Einstand</div>}</td>
                  <td>{pi ? <DataBadge f={assessFreshness({ dataDate: pi.asOf, fetchedAt: pi.fetchedAt, frequency: pi.interval === "WEEK" ? "weekly" : "daily", today: pf.today, isDemo: pi.isDemo, isSnapshot: pi.isSnapshot, isManual: pi.source.startsWith("manuell") })} provider={pi.source} /> : null}</td>
                  <td className="num">{money(p.valueBase, base)}{p.fxNow && p.fxNow.rate !== 1 && <div className="text-[11px] text-ink-3" title={p.fxNow.path}>FX {num(p.fxNow.rate, 4)} ({p.fxNow.source ?? "–"}, {dateDe(p.fxNow.date)})</div>}</td>
                  <td className="num">{pct(p.weightPct, 1, false)}</td>
                  <td className="num">{money(p.priceEffectBase, base)}</td>
                  <td className="num">{money(p.fxEffectBase, base)}</td>
                  <td className={"num " + ((p.unrealizedBase ?? 0) >= 0 ? "text-good" : "text-bad")}>{money(p.unrealizedBase, base)}<div className="text-xs">{pct(p.unrealizedPct)}</div></td>
                  <td className="max-w-56 text-xs text-warn">{p.warnings.map((w) => <div key={w}>▲ {w}</div>)}</td>
                </tr>
              );
            })}
          </Table>
        ) : <Empty>Noch keine offenen Positionen.</Empty>}
        <p className="mt-2 text-[11px] text-ink-3">Summe investiert {money(r.investedValueBase, base)} · Einstand {money(r.costBaseTotal, base)} · Konzentration: größte Position {r.concentration.largest ?? "–"} {pct(r.concentration.top1Pct, 1, false)}, Top 3 {pct(r.concentration.top3Pct, 1, false)}, HHI {num(r.concentration.hhi, 3)}</p>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Buchung erfassen">
          <ActionForm action={addTransaction} submit="Buchen" className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Art"><select name="side" defaultValue="BUY"><option value="BUY">Kauf</option><option value="SELL">Verkauf</option><option value="DIVIDEND">Dividende (Gesamtbetrag in „Kurs“)</option></select></Field>
            <Field label="Datum"><input name="tradeDate" type="date" required defaultValue={pf.today} /></Field>
            <Field label="Symbol"><input name="symbol" required placeholder="AAPL" /></Field>
            <Field label="Name"><input name="name" placeholder="Apple Inc." /></Field>
            <Field label="Asset-Typ"><select name="assetType" defaultValue="STOCK"><option value="STOCK">Aktie</option><option value="ETF">ETF</option><option value="CRYPTO">Krypto</option><option value="OTHER">Sonstige</option></select></Field>
            <Field label="Börse / Handelsplatz"><input name="exchange" placeholder="NASDAQ" /></Field>
            <Field label="Handelswährung"><input name="currency" required defaultValue={base} maxLength={3} /></Field>
            <Field label="Menge"><input name="quantity" required inputMode="decimal" /></Field>
            <Field label="Kurs je Stück"><input name="price" required inputMode="decimal" /></Field>
            <Field label="Gebühren"><input name="fees" inputMode="decimal" placeholder="0" /></Field>
            <Field label="Gebührenwährung"><input name="feeCurrency" maxLength={3} placeholder="wie Handelswährung" /></Field>
            <Field label={`Wechselkurs (${base} je 1 Handelswährung)`} hint="Pflicht für korrekten Einstand bei Fremdwährung"><input name="fxToBase" inputMode="decimal" /></Field>
            <div className="col-span-2 md:col-span-2"><Field label="Notiz"><input name="note" /></Field></div>
            <label className="flex items-end gap-2 pb-1 text-xs text-ink-2"><input type="checkbox" name="adjustCash" defaultChecked /> Liquidität entsprechend anpassen</label>
          </ActionForm>
          <p className="mt-2 text-[11px] text-ink-3">Es werden keine Broker-Zugänge, Seed-Phrasen oder privaten Schlüssel benötigt oder gespeichert. Buchungen sind reine Aufzeichnungen.</p>
        </Card>
        <Card title="CSV-Import (mit Vorschau)">
          <CsvImport />
          <div className="mt-4 border-t border-line pt-3"><h3 className="mb-2 text-xs font-semibold">Bisheriges Handelsbuch übernehmen</h3><LegacyImport /></div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Liquidität">
          <ActionForm action={addCash} submit="Erfassen" className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Field label="Datum"><input type="date" name="date" defaultValue={pf.today} /></Field>
            <Field label="Art"><select name="type"><option value="DEPOSIT">Einzahlung</option><option value="WITHDRAWAL">Auszahlung</option><option value="ADJUSTMENT">Korrektur (+)</option></select></Field>
            <Field label="Betrag"><input name="amount" inputMode="decimal" /></Field>
            <Field label="Währung"><input name="currency" defaultValue={base} maxLength={3} /></Field>
            <Field label="Notiz"><input name="note" /></Field>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-2">Aktuelle Liquidität: {money(pf.cash.base, base)}. Buchungen passen die Liquidität nur an, wenn „Liquidität entsprechend anpassen“ gewählt ist (in Handelswährung; Fremdwährung wird mit aktuellem Kurs bewertet). CSV-/Altimporte ändern die Liquidität nicht.</p>
          {cash.length > 0 && <ul className="mt-2 max-h-40 overflow-auto text-xs">{cash.map((c) => <li key={c.id} className="border-b border-line py-1">{dateDe(c.date)} {c.type} {money(c.amount, c.currency)} {c.note}{c.isDemo && <Badge tone="bad">DEMO</Badge>}</li>)}</ul>}
        </Card>
        <Card title="Wechselkurs manuell (Fallback)">
          <p className="mb-2 text-xs text-ink-2">Nur genutzt, wenn keine Quelle (EZB, Alpha Vantage, FRED) liefert. Format: Paar „EURUSD“ = USD je 1 EUR. Aktive Kurse: {pf.fxRates.map((x) => `${x.pair} ${num(x.rate, 4)} (${x.source}, ${dateDe(x.date)})`).join(" · ") || "keine"}</p>
          <ActionForm action={saveManualFx} className="grid grid-cols-3 gap-3">
            <Field label="Paar"><input name="pair" defaultValue="EURUSD" maxLength={6} /></Field>
            <Field label="Kurs"><input name="rate" inputMode="decimal" /></Field>
            <Field label="Datenstand"><input type="date" name="date" defaultValue={pf.today} /></Field>
          </ActionForm>
        </Card>
      </div>

      <Card title="Kaufhistorie & Buchungen" className="mt-4">
        {txs.length ? (
          <Table head={["Datum", "Art", "Wert", "Menge", "Kurs", "Gebühr", `FX → ${base}`, "Notiz", ""]}>
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{dateDe(t.tradeDate)}</td>
                <td>{t.side === "BUY" ? "Kauf" : t.side === "SELL" ? "Verkauf" : "Dividende"}{t.isDemo && <> <Badge tone="bad">DEMO</Badge></>}</td>
                <td>{t.instrument.symbol}</td>
                <td className="num">{qty(t.quantity)}</td>
                <td className="num">{money(t.price, t.priceCurrency)}</td>
                <td className="num">{t.fees ? money(t.fees, t.feeCurrency ?? t.priceCurrency) : "–"}</td>
                <td className="num">{t.fxToBase != null ? num(t.fxToBase, 4) : <Badge tone="warn">fehlt</Badge>}</td>
                <td className="text-xs text-ink-2">{t.note}</td>
                <td><form action={deleteTransaction}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-bad" aria-label="Buchung löschen">löschen</button></form></td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Keine Buchungen.</Empty>}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Realisierte Ergebnisse (FIFO)">
          {realized.length ? (
            <Table head={["Datum", "Wert", "Menge", `Erlös ${base}`, `Kosten ${base}`, `G/V ${base}`, "Krypto > 1 Jahr"]}>
              {realized.map((x) => (
                <tr key={x.txId}><td>{dateDe(x.date)}</td><td>{instById.get(x.instrumentId)?.symbol}</td><td className="num">{qty(x.qty)}</td><td className="num">{money(x.proceedsBase, base)}</td><td className="num">{money(x.costBase, base)}</td><td className={"num " + ((x.plBase ?? 0) >= 0 ? "text-good" : "text-bad")}>{money(x.plBase, base)}</td><td className="num">{x.plOverOneYearBase != null ? money(x.plOverOneYearBase, base) : "–"}</td></tr>
              ))}
            </Table>
          ) : <Empty>Noch keine Verkäufe.</Empty>}
          <p className="mt-2 text-[11px] text-ink-3">Krypto: Anteil aus Lots mit mehr als einem Jahr Haltedauer (Hinweis wie im bisherigen Handelsbuch, keine Steuerberatung).</p>
        </Card>
        <Card title="Krypto-Haltefristen je Kauf">
          {(() => {
            const lots = open.filter((p) => p.instrument.assetType === "CRYPTO").flatMap((p) => p.lots.map((l) => ({ p, l })));
            return lots.length ? (
              <Table head={["Wert", "Kaufdatum", "Restmenge", "frei ab", "Status"]}>
                {lots.map(({ p, l }) => <tr key={l.txId}><td>{p.instrument.symbol}</td><td>{dateDe(l.date)}</td><td className="num">{qty(l.left)}</td><td>{dateDe(l.holdingFreeFrom)}</td><td>{l.holdingFreeFrom <= pf.today ? <Badge tone="good">über ein Jahr gehalten</Badge> : <Badge tone="neutral">{Math.ceil((Date.parse(l.holdingFreeFrom) - Date.parse(pf.today)) / 86400000)} Tage</Badge>}</td></tr>)}
              </Table>
            ) : <Empty>Keine Krypto-Lots.</Empty>;
          })()}
        </Card>
      </div>

      <Card title="Sparpläne" className="mt-4" actions={<Link href="/kaufplan" className="text-xs text-accent">Kaufplan →</Link>}>
        {plans.length ? <ul className="text-sm">{plans.map((p) => <li key={p.id}>{p.instrument.symbol}: {money(p.amount, p.currency)} {p.interval === "MONTHLY" ? "monatlich" : "quartalsweise"} am {p.dayOfMonth}.{p.isDemo && <> <Badge tone="bad">DEMO</Badge></>}</li>)}</ul> : <Empty>Keine Sparpläne.</Empty>}
      </Card>
    </div>
  );
}
