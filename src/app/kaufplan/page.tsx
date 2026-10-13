import { displayFx } from "@/lib/server/data";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { loadPortfolio } from "@/lib/server/portfolio";
import { getGeneral, getRuleConfig } from "@/lib/settings";
import { shockScenario, simulateBuy, nextPlanDates } from "@/lib/calc/simulate";
import { Card, PageHeader, Badge, Empty, Table, Field, Stat, DemoBanner, Disclaimer } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { addTranche, addSavingsPlan, setTrancheStatus } from "@/app/actions";
import { moneyDual, pct, dateDe, num } from "@/lib/format";
import { parseDecimal } from "@/lib/portfolio/import";

export const dynamic = "force-dynamic";

export default async function Kaufplan({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Euro-Beträge mit Dollarwert daneben (Kurs: displayFx, Quelle in der Fußzeile)
  const fx = await displayFx();
  const money = (v: number | null | undefined, c: string, d?: number) => moneyDual(v, c, fx, d);
  const sp = await searchParams;
  const [pf, general, cfg] = await Promise.all([loadPortfolio(), getGeneral(), getRuleConfig()]);
  const base = pf.base;
  const r = pf.result;
  const cash = pf.cash.base ?? 0;
  const plans = await prisma.savingsPlan.findMany({ where: { active: true }, include: { instrument: true } });
  const tranches = await prisma.plannedTranche.findMany({ include: { instrument: true }, orderBy: { createdAt: "desc" } });
  const open = r.positions.filter((p) => p.qty > 1e-10 && p.valueBase != null);
  const sectors = [...new Set(open.map((p) => p.instrument.sector).filter(Boolean))] as string[];
  const simPos = open.map((p) => ({ symbol: p.instrument.symbol, valueBase: p.valueBase!, tags: [p.instrument.sector ?? ""] }));
  const shock = parseDecimal(sp.shock ?? "-10") ?? -10;
  const tag = sp.tag ?? "";
  const tagShock = parseDecimal(sp.tagShock ?? "-35") ?? -35;
  const scen = shockScenario(simPos, cash, shock, tag ? { tag, shockPct: tagShock } : undefined);
  let buy: ReturnType<typeof simulateBuy> | null = null;
  let buyErr = "";
  if (sp.buySymbol && sp.buyAmount) { try { buy = simulateBuy(simPos, cash, sp.buySymbol.toUpperCase(), parseDecimal(sp.buyAmount) ?? 0); } catch (e) { buyErr = (e as Error).message; } }
  const monthly = plans.reduce((s, p) => s + (p.currency === base ? (p.interval === "MONTHLY" ? p.amount : p.amount / 3) : 0), 0);
  const openTranches = tranches.filter((t) => t.status === "OFFEN");
  const reserved = openTranches.reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      {pf.hasDemo && <DemoBanner />}
      <PageHeader title="Kaufplan & Cashverwaltung" subtitle="Planung und Simulation – es werden keine Orders abgesetzt." />
      <div className="grid gap-4 md:grid-cols-4">
        <Card><Stat label="Freie Liquidität" value={money(pf.cash.base, base)} sub={`abzgl. geplanter Tranchen: ${money(cash - reserved, base)}`} /></Card>
        <Card><Stat label="Cashquote" value={pct(r.cashQuotaPct, 1, false)} sub={`Ziel ${pct(general.targetCashQuotaPct, 0, false)} · Referenz bei schwacher Breite ${pct(cfg.referenceCashQuotaPct, 0, false)}`} tone={r.cashQuotaPct != null && r.cashQuotaPct < general.targetCashQuotaPct ? "bad" : null} /></Card>
        <Card><Stat label="Monatsbudget" value={money(general.monthlyBudget, base)} sub={<Link href="/einstellungen" className="text-accent">ändern</Link>} /></Card>
        <Card><Stat label="Sparpläne / Monat" value={money(monthly, base)} sub={monthly > general.monthlyBudget && general.monthlyBudget > 0 ? "über Budget" : undefined} /></Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Regelmäßige Käufe (Sparpläne)">
          {plans.length ? <Table head={["Wert", "Betrag", "Rhythmus", "Nächste Termine"]}>{plans.map((p) => <tr key={p.id}><td>{p.instrument.symbol}{p.isDemo && <> <Badge tone="bad">DEMO</Badge></>}</td><td className="num">{money(p.amount, p.currency)}</td><td>{p.interval === "MONTHLY" ? "monatlich" : "quartalsweise"} am {p.dayOfMonth}.</td><td className="text-xs">{nextPlanDates(p.startDate.toISOString().slice(0, 10), p.dayOfMonth, p.interval as "MONTHLY", pf.today).map(dateDe).join(", ")}</td></tr>)}</Table> : <Empty>Keine Sparpläne.</Empty>}
          <ActionForm action={addSavingsPlan} submit="Sparplan anlegen" className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
            <Field label="Symbol"><input name="symbol" /></Field>
            <Field label="Betrag"><input name="amount" /></Field>
            <Field label="Währung"><input name="currency" defaultValue={base} /></Field>
            <Field label="Rhythmus"><select name="interval"><option value="MONTHLY">monatlich</option><option value="QUARTERLY">quartalsweise</option></select></Field>
            <Field label="Tag"><input name="day" defaultValue="1" /></Field>
            <Field label="Start"><input type="date" name="startDate" defaultValue={pf.today} /></Field>
          </ActionForm>
        </Card>
        <Card title="Geplante Kauftranchen">
          {tranches.length ? <Table head={["Wert", "Betrag", "Auslöser", "Abstand", "Bedingung", "Status"]}>{tranches.map((t) => { const px = pf.prices.get(t.instrumentId); const d = px && t.triggerPrice ? ((px.price - t.triggerPrice) / t.triggerPrice) * 100 : null; return <tr key={t.id}><td>{t.instrument.symbol}</td><td className="num">{money(t.amount, base)}</td><td className="num">{t.triggerPrice ? money(t.triggerPrice, t.currency) : "–"}</td><td className="num">{pct(d)}</td><td className="text-xs">{t.condition}</td><td><form action={setTrancheStatus} className="flex gap-1"><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} className="text-xs"><option value="OFFEN">offen</option><option value="AUSGEFÜHRT_MANUELL">selbst ausgeführt</option><option value="VERWORFEN">verworfen</option></select><button className="text-xs text-accent">ok</button></form></td></tr>; })}</Table> : <Empty>Keine Tranchen.</Empty>}
          <ActionForm action={addTranche} submit="Tranche planen" className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Symbol"><input name="symbol" /></Field>
            <Field label={`Betrag (${base})`}><input name="amount" /></Field>
            <Field label="Auslösekurs (Handelswährung)"><input name="triggerPrice" /></Field>
            <Field label="Bedingung"><input name="condition" placeholder="z. B. These intakt, RSI14 < 30" /></Field>
          </ActionForm>
          <p className="mt-2 text-[11px] text-ink-3">Tranchen bei Stage 4 nicht automatisch vollständig einsetzen (Regel C3). Ein Rücksetzer von {cfg.marketPullbackPct} % überstimmt keine anderen Risikohinweise.</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Szenario: Rücksetzer">
          <form className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Marktrücksetzer %"><input name="shock" defaultValue={String(shock)} /></Field>
            <Field label="Zusätzlicher Schock für Sektor"><select name="tag" defaultValue={tag}><option value="">keiner</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Sektor-Schock %" hint="Referenz-Stressszenario KI: −30 bis −40 %"><input name="tagShock" defaultValue={String(tagShock)} /></Field>
            <div className="flex items-end"><button className="rounded-md border border-line px-3 py-1.5">Berechnen</button></div>
          </form>
          <p className="mt-3 text-sm">Depotwert {money(scen.totalBefore, base)} → <b>{money(scen.totalAfter, base)}</b> ({pct(scen.changePct)}); Cashquote danach {pct(scen.cashQuotaAfter, 1, false)}.</p>
          <ul className="mt-1 text-xs text-ink-2">{scen.rows.map((x) => <li key={x.symbol}>{x.symbol}: {money(x.before, base)} → {money(x.after, base)} ({pct(x.changePct, 0)})</li>)}</ul>
          <p className="mt-2 text-[11px] text-ink-3">Stressszenario, keine Vorhersage. Liquidität bleibt unverändert.</p>
        </Card>
        <Card title="Simulation: hypothetischer Kauf">
          <form className="grid grid-cols-3 gap-2">
            <Field label="Symbol"><input name="buySymbol" defaultValue={sp.buySymbol} /></Field>
            <Field label={`Betrag (${base})`}><input name="buyAmount" defaultValue={sp.buyAmount} /></Field>
            <div className="flex items-end"><button className="rounded-md border border-line px-3 py-1.5">Simulieren</button></div>
          </form>
          {buyErr && <p className="mt-2 text-xs text-bad">■ {buyErr}</p>}
          {buy && <><p className="mt-2 text-sm">Liquidität danach {money(buy.cashAfter, base)} · Cashquote {pct(buy.cashQuotaAfter, 1, false)}</p><ul className="text-xs">{buy.weights.map((w) => <li key={w.symbol}>{w.symbol}: {pct(w.weightPct, 1, false)}{w.weightPct > general.maxPositionWeightPct && <> <Badge tone="warn">über {num(general.maxPositionWeightPct, 0)} %</Badge></>}</li>)}</ul></>}
          <p className="mt-2 text-[11px] text-ink-3">Reine Rechnung – es wird keine Order erzeugt. Vorher Kauf-Cockpit und Detailprüfung beachten.</p>
        </Card>
      </div>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
