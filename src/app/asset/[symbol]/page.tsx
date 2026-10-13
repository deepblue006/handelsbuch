import { displayFx } from "@/lib/server/data";
import Link from "next/link";
import { notFound } from "next/navigation";
import { analyzeAsset } from "@/lib/server/analysis";
import { prisma } from "@/lib/db";
import { Card, PageHeader, Badge, DataBadge, Empty, Table, Field, Missing, DemoBanner, Disclaimer } from "@/components/ui";
import { LinesChart } from "@/components/charts";
import { ActionForm } from "@/components/forms";
import { ReverseValuation } from "@/components/reverse-valuation";
import { saveValuation, saveMeta, addLevel, addThesisEvent, addAnalystAction, importPrices, addSplit, deleteSplit, confirmSplitList } from "@/app/actions";
import { formatSplitRatio } from "@/lib/calc/splits";
import { CG_ATTRIBUTION } from "@/lib/providers/coingecko";
import { COMPONENT_LABELS, STATE_LABELS } from "@/lib/score/score";
import { moneyDual, num, pct, dateDe, dateTimeDe, compact, qty } from "@/lib/format";
import { FORM4_CODES } from "@/lib/providers/alphavantage";
import { upcomingFomc } from "@/lib/fomc";
import { classifyPeg } from "@/lib/calc/valuation";

export const dynamic = "force-dynamic";

const ruleTone = (s: string, d: string) => (s === "AUSGELÖST" ? (d === "PRO" ? "good" : d === "CONTRA" ? "bad" : "warn") : s === "DATEN_FEHLEN" ? "warn" : "neutral") as "good" | "bad" | "warn" | "neutral";

export default async function AssetPage({ params }: { params: Promise<{ symbol: string }> }) {
  // Euro-Beträge mit Dollarwert daneben (Kurs: displayFx, Quelle in der Fußzeile)
  const fx = await displayFx();
  const money = (v: number | null | undefined, c: string, d?: number) => moneyDual(v, c, fx, d);
  const { symbol } = await params;
  const a = await analyzeAsset(decodeURIComponent(symbol).toUpperCase());
  if (!a) notFound();
  const { inst, indicators: ind, score, rules } = a;
  const cur = inst.currency;
  const isCrypto = inst.assetType === "CRYPTO";
  const v = a.valuation.assumptions;
  const sc = (label: string) => v?.scenarios.find((s) => s.label === label);
  const fomc = upcomingFomc(a.today, 2);
  const hasDemo = a.priceInfo?.isDemo || inst.isDemo;
  const tranches = await prisma.plannedTranche.findMany({ where: { instrumentId: inst.id, status: "OFFEN" } });

  return (
    <div>
      {hasDemo && <DemoBanner />}
      <PageHeader
        title={`${inst.symbol} – ${inst.name}`}
        subtitle={<>{inst.assetType} · Heimatbörse {inst.exchange ?? "unbekannt"} · Handelswährung {cur}{inst.sector ? ` · ${inst.sector}` : ""}{isCrypto && " · Krypto-Analysen sind Dashboard-Erweiterungen, nicht Teil des Finanzwiesel-Regelwerks"}</>}
        actions={<div className="text-right"><div className="text-2xl font-semibold">{money(a.price, cur)}</div><div className="mt-1 flex justify-end gap-1"><DataBadge f={a.dailyMeta.count ? a.dailyMeta.freshness : a.weeklyMeta.freshness} provider={a.dailyMeta.count ? a.dailyMeta.provider : a.weeklyMeta.provider} /></div><div className="text-[11px] text-ink-3">Schlusskurs vom {dateDe(a.priceDate)}</div></div>}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Kauf- / Nachkaufprüfung" className="xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={score.state === "MÖGLICHER_EINSTIEG" || score.state === "MÖGLICHER_GESTAFFELTER_NACHKAUF" ? "good" : score.state === "ERHÖHTES_RISIKO" || score.state === "THESE_NEU_PRÜFEN" ? "bad" : "warn"}>{STATE_LABELS[score.state]}</Badge>
            <span className="text-sm">Score {score.total != null ? <b>{num(score.total, 0)} / 100</b> : <Missing>nicht berechenbar</Missing>} · Vollständigkeit {pct(score.completeness * 100, 0, false)}</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">{score.stateReason}</p>
          {rules.blocksNewBuy && <p className="mt-1"><Badge tone="bad">Regel D1: Kurs über Fair Value – kein Neukauf allein wegen anderer Signale</Badge></p>}
          {rules.conflicts.length > 0 && <div className="mt-2 rounded-md border border-[color:var(--warn)]/50 p-2 text-xs"><b>Regelkonflikte:</b><ul className="list-inside list-disc">{rules.conflicts.map((c) => <li key={c}>{c}</li>)}</ul></div>}
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div><h3 className="text-xs font-semibold text-good">Dafür</h3><ul className="mt-1 space-y-1 text-xs">{[...rules.pros.map((r) => r.title + ": " + r.message), ...score.positives].map((x) => <li key={x}>● {x}</li>)}{!rules.pros.length && !score.positives.length && <li className="text-ink-3">–</li>}</ul></div>
            <div><h3 className="text-xs font-semibold text-bad">Dagegen</h3><ul className="mt-1 space-y-1 text-xs">{score.againstBuying.map((x) => <li key={x}>■ {x}</li>)}{!score.againstBuying.length && <li className="text-ink-3">–</li>}</ul></div>
            <div><h3 className="text-xs font-semibold text-warn">Fehlt / nächste Prüfung</h3><ul className="mt-1 space-y-1 text-xs">{rules.nextSteps.slice(0, 8).map((x) => <li key={x}>▲ {x}</li>)}</ul></div>
          </div>
          <Table className="mt-3" head={["Komponente", "Gewicht (eff.)", "Teilscore", "Faktoren", "Fehlend"]}>
            {score.components.map((c) => (
              <tr key={c.key}>
                <td>{COMPONENT_LABELS[c.key]}</td>
                <td className="num">{c.notApplicable ? "n. a." : score.effectiveWeights[c.key] != null ? pct(score.effectiveWeights[c.key]!, 0, false) : "0 %"}</td>
                <td className="num">{c.notApplicable ? <Missing>nicht anwendbar</Missing> : c.score != null ? num(c.score, 0) : <Missing>fehlt</Missing>}</td>
                <td className="text-xs">{c.factors.map((f) => <div key={f.label}>{f.points > 0 ? "+" : ""}{f.points} · {f.label} ({f.value})</div>)}</td>
                <td className="text-xs text-ink-3">{c.missing.join(", ")}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-[11px] text-ink-3">{score.warnings.join(" ")} Politikertransaktionen und Truth-Social-Posts sind keine Score-Komponenten.</p>
        </Card>

        <Card title="Position & These">
          {a.position ? (
            <div className="space-y-1 text-sm">
              <div>{qty(a.position.qty)} Stück · Ø Einstand {money(a.position.avgCostCcy, cur)} ({pct(a.position.vsCostPct)})</div>
              <div>Marktwert {money(a.position.valueBase, a.general.baseCurrency)} · Anteil {pct(a.position.weightPct, 1, false)}</div>
            </div>
          ) : <p className="text-sm text-ink-2">Keine Position.</p>}
          <ActionForm action={saveMeta} className="mt-3 grid grid-cols-2 gap-2">
            <input type="hidden" name="instrumentId" value={inst.id} />
            <div className="col-span-2"><Field label="Investmentthese"><textarea name="thesis" rows={3} defaultValue={inst.meta?.thesis ?? ""} /></Field></div>
            <Field label="Thesenstatus"><select name="thesisStatus" defaultValue={inst.meta?.thesisStatus ?? ""}><option value="">nicht bewertet</option><option value="INTAKT">intakt</option><option value="PRÜFEN">prüfen</option><option value="VERLETZT">verletzt</option></select></Field>
            <Field label="Anlagehorizont"><input name="horizon" defaultValue={inst.meta?.horizon ?? ""} /></Field>
            <Field label="Zielgewicht %"><input name="targetWeightPct" defaultValue={inst.meta?.targetWeightPct ?? ""} /></Field>
            <Field label="Max. Gewicht %"><input name="maxWeightPct" defaultValue={inst.meta?.maxWeightPct ?? ""} /></Field>
            <div className="col-span-2"><Field label={`Nachkaufmarken (${cur}, mit ; getrennt)`}><input name="rebuyMarks" defaultValue={((inst.meta?.rebuyMarks as { price: number }[]) ?? []).map((m) => m.price).join("; ")} /></Field></div>
            <Field label="Geschäftsmodell"><select name="businessModel" defaultValue={inst.businessModel ?? "STANDARD"}><option value="STANDARD">Standard</option><option value="BANK">Bank</option><option value="INSURANCE">Versicherer</option><option value="REIT">REIT</option><option value="COMMODITY">Rohstoff</option><option value="OTHER">Sonstiges</option></select></Field>
            <Field label="Sektor"><input name="sector" defaultValue={inst.sector ?? ""} /></Field>
            <Field label="Präferenz"><select name="preference" defaultValue={inst.meta?.preference ?? ""}><option value="">keine</option><option value="HOLD_ONLY">nur halten</option></select></Field>
            <Field label="Präferenz-Notiz"><input name="preferenceNote" defaultValue={inst.meta?.preferenceNote ?? ""} /></Field>
            <div className="col-span-2"><Field label="Risiken / Notizen"><textarea name="riskNotes" rows={2} defaultValue={inst.meta?.riskNotes ?? ""} /></Field></div>
          </ActionForm>
          {inst.meta?.preference === "HOLD_ONLY" && <p className="mt-2"><Badge tone="info">Präferenz „nur halten“ – editierbar, löst keine Aktion aus</Badge></p>}
          {tranches.length > 0 && <p className="mt-2 text-xs">Offene Tranchen: {tranches.map((t) => `${money(t.amount, a.general.baseCurrency)}${t.triggerPrice ? ` @ ${money(t.triggerPrice, t.currency)}` : ""}`).join(", ")}</p>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title={a.chart.length ? "Kurs & gleitende Durchschnitte (Tage)" : "Kurs & gleitende Durchschnitte (Wochen)"} className="xl:col-span-2">
          {a.chart.length ? (
            <>
              <LinesChart data={a.chart} series={[{ key: "close", label: `Schluss (${cur})`, color: "var(--s1)" }, { key: "sma50", label: "SMA 50", color: "var(--s2)" }, { key: "sma200", label: "SMA 200", color: "var(--s7)" }, { key: "ema20", label: "EMA 20", color: "var(--s3)", dashed: true, width: 1.5 }]} />
              <h3 className="mt-3 text-xs font-semibold text-ink-2">RSI 14 / RSI 5</h3>
              <LinesChart height={140} data={a.chart} domain={[0, 100]} refLines={[{ y: 70, label: "70" }, { y: 30, label: "30" }]} series={[{ key: "rsi14", label: "RSI 14", color: "var(--s1)" }, { key: "rsi5", label: "RSI 5", color: "var(--s2)", width: 1.5 }]} />
            </>
          ) : a.weeklyChart.length ? (
            <>
              <LinesChart data={a.weeklyChart} series={[{ key: "close", label: `Wochenschluss (${cur})`, color: "var(--s1)" }, { key: "sma30w", label: "SMA 30 Wochen", color: "var(--s2)" }, { key: "sma200w", label: "SMA 200 Wochen", color: "var(--s7)" }]} />
              <h3 className="mt-3 text-xs font-semibold text-ink-2">RSI 14 (Wochenbasis – ersetzt nicht den Tages-RSI)</h3>
              <LinesChart height={140} data={a.weeklyChart} domain={[0, 100]} refLines={[{ y: 70, label: "70" }, { y: 30, label: "30" }]} series={[{ key: "rsi14w", label: "RSI 14 (Wochen)", color: "var(--s1)" }]} />
            </>
          ) : <Empty>Keine Kursreihe vorhanden.</Empty>}
          <p className="mt-2 text-[11px] text-ink-3">Tageskurse: {a.dailyMeta.count} ({a.dailyMeta.provider ?? "–"}, bis {dateDe(a.dailyMeta.lastDate)}) · Wochenkurse: {a.weeklyMeta.count} ({a.weeklyMeta.source}{a.weeklyMeta.provider ? `, ${a.weeklyMeta.provider}` : ""}) · {a.dailyMeta.adjusted || a.weeklyMeta.adjusted ? "vom Anbieter bereinigt" : a.splitInfo.verified ? `Rohkurse, mit geprüfter Splitliste bereinigt (${a.splitInfo.checkedSource ?? "–"}), nicht dividendenbereinigt` : a.splitInfo.applied.length ? `Rohkurse, ${a.splitInfo.applied.length} bekannte(r) Split(s) bereinigt, Liste nicht als vollständig bestätigt` : "Rohkurse, nicht split-/dividendenbereinigt"}</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-accent">Kurshistorie aus CSV importieren (für SMA 200, RSI, Backtest)</summary>
            <ActionForm action={importPrices} submit="Importieren" className="mt-2 flex flex-wrap items-end gap-2 text-xs">
              <input type="hidden" name="instrumentId" value={inst.id} />
              <input type="file" name="csv" accept=".csv,text/csv" aria-label="Kurs-CSV" />
              <Field label="Währung"><input name="currency" defaultValue={cur} className="w-16" /></Field>
              <label className="flex items-center gap-1"><input type="checkbox" name="adjusted" /> bereinigten Schluss (Adj Close) verwenden</label>
            </ActionForm>
            <p className="mt-1 text-[11px] text-ink-3">Spalten Datum/Date und Schluss/Close (optional Eröffnung, Hoch, Tief, Volumen, Adj Close). Nur selbst bezogene Daten verwenden, deren Nutzung dir erlaubt ist. Kurse der Heimatbörse in Handelswährung.</p>
          </details>
          {(a.splits.daily.length > 0 || a.splits.weekly.length > 0) && <p className="mt-1"><Badge tone="warn">Möglicher unbereinigter Split: {[...a.splits.daily, ...a.splits.weekly].map((s) => `${dateDe(s.date)} (Faktor ${num(s.factor, 2)})`).join(", ")} – Durchschnitte über diesen Zeitpunkt sind verfälscht</Badge></p>}
          <details id="splits" className="mt-2" open={a.splits.daily.length + a.splits.weekly.length + a.splitInfo.problems.length + a.splitInfo.events.length > 0 || undefined}>
            <summary className="cursor-pointer text-xs text-accent">Splits ({a.splitInfo.events.length} erfasst{a.splitInfo.verified ? ", Liste geprüft" : ""})</summary>
            {a.splitInfo.problems.map((p) => <p key={p} className="mt-1 text-[11px] text-bad">■ {p}</p>)}
            {a.splitInfo.events.length > 0 ? (
              <Table head={["Wirksam ab", "Verhältnis", "Quelle", ""]}>
                {a.splitInfo.events.map((e) => <tr key={e.id}><td>{dateDe(e.date)}</td><td className="num">{formatSplitRatio(e.factor)}</td><td className="text-xs">{e.provider === "manuell" ? `manuell: ${e.source}` : e.source}</td><td>{e.provider === "manuell" && <ActionForm action={deleteSplit} submit="Löschen" className="text-xs"><input type="hidden" name="id" value={e.id} /></ActionForm>}</td></tr>)}
              </Table>
            ) : <p className="mt-1 text-[11px] text-ink-3">Keine Splits erfasst.</p>}
            {a.splitInfo.approximateBars.length > 0 && <p className="mt-1 text-[11px] text-ink-3">Wochenkerzen mit Split innerhalb der Woche ({a.splitInfo.approximateBars.map(dateDe).join(", ")}): Schluss exakt, Eröffnung/Hoch/Tief nur näherungsweise bereinigt.</p>}
            {a.splitInfo.verified && a.splitInfo.realJumps.length > 0 && <p className="mt-1 text-[11px] text-ink-3">Split-ähnliche Kurssprünge ohne Split laut Quelle (echte Kursbewegung): {a.splitInfo.realJumps.map((j) => dateDe(j.date)).join(", ")}.</p>}
            <ActionForm action={addSplit} submit="Split speichern" className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <input type="hidden" name="instrumentId" value={inst.id} />
              <Field label="Wirksam ab (erster Handelstag nach Split)"><input type="date" name="date" /></Field>
              <Field label="Verhältnis neu:alt"><input name="ratio" placeholder="4:1 oder 1:10" /></Field>
              <div className="col-span-2"><Field label="Quelle (Pflicht)"><input name="source" placeholder="z. B. Emittenten-Mitteilung vom …" /></Field></div>
            </ActionForm>
            {a.splitInfo.checkedAt ? (
              <ActionForm action={confirmSplitList} submit="Bestätigung widerrufen" className="mt-2 text-xs">
                <input type="hidden" name="instrumentId" value={inst.id} /><input type="hidden" name="revoke" value="1" />
                <p className="text-[11px] text-ink-3">Liste als vollständig bestätigt am {dateTimeDe(a.splitInfo.checkedAt)} ({a.splitInfo.checkedSource}).</p>
              </ActionForm>
            ) : (
              <ActionForm action={confirmSplitList} submit="Liste als vollständig bestätigen" className="mt-2 flex flex-wrap items-end gap-2 text-xs">
                <input type="hidden" name="instrumentId" value={inst.id} />
                <Field label="Quelle der vollständigen Splithistorie"><input name="source" placeholder="z. B. Investor-Relations-Seite, abgerufen am …" className="w-72" /></Field>
              </ActionForm>
            )}
            <p className="mt-1 text-[11px] text-ink-3">Bereinigt werden nur Rohkurse; Kurse vor dem Wirksamkeitsdatum werden durch den Faktor geteilt. Erst eine als vollständig bestätigte Liste (manuell oder per Alpha-Vantage-Abruf) schaltet die heuristische Split-Warnung ab – und nur, wenn kein Kurssprung nahe einem gemeldeten Split übrig bleibt.</p>
          </details>
        </Card>

        <Card title="Trend & Indikatoren">
          <Table head={["Kennzahl", "Wert", "Abstand Kurs"]}>
            {[
              ["SMA 50 (Tage)", ind.sma50, ind.dist50, 50],
              ["SMA 100 (Tage)", ind.sma100, null, 100],
              ["SMA 200 (Tage)", ind.sma200, ind.dist200, 200],
              ["EMA 10 (kurzfristig)", ind.ema10, null, 10],
              ["EMA 20 (kurzfristig)", ind.ema20, null, 20],
              ["SMA 30 Wochen", ind.sma30w, ind.dist30w, -30],
              ["SMA 200 Wochen", ind.sma200w, ind.dist200w, -200],
            ].map(([l, val, d, need]) => (
              <tr key={l as string}><td>{l as string}</td><td className="num">{val != null ? num(val as number) : <Missing>{(need as number) > 0 ? `braucht ${need} Tageskurse (vorh. ${a.dailyMeta.count})` : `braucht ${-(need as number)} Wochen (vorh. ${a.weeklyMeta.count})`}</Missing>}</td><td className="num">{pct(d as number | null)}</td></tr>
            ))}
            <tr><td>RSI 14 / RSI 5 (Tage)</td><td className="num">{ind.rsi14 != null ? `${num(ind.rsi14, 1)} / ${num(ind.rsi5, 1)}` : <Missing>keine Tageskurse</Missing>}</td><td /></tr>
            <tr><td>RSI 14 (Wochen)</td><td className="num">{num(ind.rsi14w, 1)}</td><td /></tr>
            <tr><td>ADR 20 Tage</td><td className="num">{ind.adr ? `${num(ind.adr.abs)} (${pct(ind.adr.pct, 2, false)})` : <Missing>–</Missing>}</td><td /></tr>
            <tr><td>Volatilität p. a.</td><td className="num">{ind.vol != null ? pct(ind.vol, 1, false) + " (Tage)" : ind.volWeekly != null ? pct(ind.volWeekly, 1, false) + " (Wochen)" : "–"}</td><td /></tr>
            <tr><td>Volumen auf/ab (50 T.)</td><td className="num">{ind.upDown?.ratio != null ? `${num(ind.upDown.ratio, 2)}×` : "–"}</td><td /></tr>
          </Table>
          <div className="mt-3 text-sm">
            <b>Stage-Analyse:</b> {a.stage?.stage ? <><Badge tone={a.stage.stage === 2 ? "good" : a.stage.stage === 4 ? "bad" : "warn"}>{a.stage.label}</Badge> {a.stage.reclaimed && <Badge tone="good">30W zurückerobert</Badge>} <span className="text-xs text-ink-2">Konfidenz {a.stage.confidence}</span></> : <Missing>zu wenige Wochenkurse</Missing>}
            <p className="text-[11px] text-ink-3">{a.stage?.method}</p>
          </div>
          <div className="mt-2 text-xs">
            <b>Golden/Death Cross (50/200 Tage):</b> {a.crosses.length ? a.crosses.map((c) => `${c.type === "GOLDEN_CROSS" ? "Golden Cross" : "Death Cross"} ${dateDe(c.date)}`).join(", ") : "keine im Datenzeitraum"} <span className="text-ink-3">– mögliche Signale mit Fehlalarmrisiko</span>
          </div>
          <p className="mt-2 text-[11px] text-ink-3">Langfristige Depotindikatoren: SMA 200 Tage, 30/200 Wochen. Kurzfristige Tradingindikatoren: EMA 10/20, RSI 5, ADR. Spread/Orderbuch: nicht verfügbar (kein geeigneter Datenzugang; wird nicht simuliert).</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Fibonacci & Zonen">
          {a.fib ? (
            <>
              <p className="text-xs text-ink-2">{a.fib.direction === "AUFWÄRTS" ? "Retracement der Aufwärtsbewegung" : "Retracement der Abwärtsbewegung"} von {money(a.fib.swingLow.price, cur)} ({dateDe(a.fib.swingLow.date)}) bis {money(a.fib.swingHigh.price, cur)} ({dateDe(a.fib.swingHigh.date)}).</p>
              <Table head={["Ratio", "Marke"]}>{a.fib.levels.map((l) => <tr key={l.ratio} className={[0.382, 0.5, 0.618].includes(l.ratio) ? "font-medium" : "text-ink-3"}><td>{num(l.ratio, 3)}</td><td className="num">{money(l.price, cur)}</td></tr>)}</Table>
              <p className="mt-1 text-xs">Golden Pocket: {money(a.fib.goldenPocket.from, cur)} – {money(a.fib.goldenPocket.to, cur)}</p>
              {a.fibConfluence.length > 0 && <p className="mt-1"><Badge tone="info">Konfluenz mit SMA 200: {a.fibConfluence.map((l) => num(l.ratio, 3)).join(", ")} – kein Beweis für eine Trendwende</Badge></p>}
              <p className="mt-1 text-[11px] text-ink-3">{a.fib.method}</p>
            </>
          ) : <Empty>Zu wenige Kurse.</Empty>}
          <h3 className="mt-3 text-xs font-semibold">Unterstützungen/Widerstände (aus Pivots)</h3>
          <ul className="text-xs">{a.zones.slice(-6).map((z) => <li key={z.mid}>{z.kind === "UNTERSTÜTZUNG" ? "▼" : "▲"} {money(z.low, cur)}–{money(z.high, cur)} · {z.touches} Berührungen · zuletzt {dateDe(z.lastTouch)}</li>)}{!a.zones.length && <li className="text-ink-3">keine Zonen mit ≥ 2 Berührungen</li>}</ul>
          <p className="mt-1 text-xs">Runde Marken: {a.roundLevels.map((x) => money(x, cur, 0)).join(" · ")} <span className="text-ink-3">(Stops nicht exakt auf runde Marken – Trading-Regel, nicht für Langfristdepot)</span></p>
          <h3 className="mt-3 text-xs font-semibold">Manuelle Marken</h3>
          <ul className="text-xs">{inst.levels.map((l) => <li key={l.id}>{l.kind === "SUPPORT" ? "Unterstützung" : "Widerstand"} {money(l.price, cur)} {l.note}</li>)}</ul>
          <form action={addLevel} className="mt-2 flex flex-wrap gap-2 text-xs"><input type="hidden" name="instrumentId" value={inst.id} /><input name="price" placeholder="Kurs" className="w-24" /><select name="kind"><option value="SUPPORT">Unterstützung</option><option value="RESISTANCE">Widerstand</option></select><input name="note" placeholder="Notiz" className="w-32" /><button className="rounded border border-line px-2">+</button></form>
        </Card>

        {isCrypto && (
          <Card title="Marktdaten (CoinGecko)" id="coingecko">
            {a.cgMarket ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Kurs: <b>{money(a.cgMarket.price, a.cgMarket.currency)}</b></div>
                  <div>24 h: <b>{pct(a.cgMarket.change24hPct, 1)}</b></div>
                  <div>Marktkapitalisierung: <b>{compact(a.cgMarket.marketCap, a.cgMarket.currency)}</b>{a.cgMarket.rank != null && <span className="text-xs text-ink-3"> (Rang {a.cgMarket.rank})</span>}</div>
                  <div>Volumen 24 h: <b>{compact(a.cgMarket.volume24h, a.cgMarket.currency)}</b></div>
                  <div>Umlauf: <b>{num(a.cgMarket.circulatingSupply, 0)}</b>{a.cgMarket.maxSupply != null && <span className="text-xs text-ink-3"> von max. {num(a.cgMarket.maxSupply, 0)}</span>}</div>
                  <div>Allzeithoch: <b>{money(a.cgMarket.ath, a.cgMarket.currency)}</b> <span className="text-xs text-ink-3">({dateDe(a.cgMarket.athDate)}, Abstand {pct(a.cgMarket.athChangePct, 1)})</span></div>
                </div>
                {a.cgMarket.missingFields.length > 0 && <p className="mt-1 text-[11px] text-warn">In der Antwort fehlende Felder: {a.cgMarket.missingFields.join(", ")} – Werte als „–“ angezeigt, nicht geschätzt.</p>}
                <p className="mt-2 text-[11px] text-ink-3">Kursstand laut CoinGecko: {dateTimeDe(a.cgMarket.lastUpdated)} · abgerufen {dateTimeDe(a.cgMarket.fetchedAt)} · aggregierter Börsenpreis, kein Handelskurs eines bestimmten Handelsplatzes. <a className="text-accent" href={CG_ATTRIBUTION.url} target="_blank" rel="noreferrer">{CG_ATTRIBUTION.text}</a></p>
              </>
            ) : <Empty>Keine CoinGecko-Marktdaten. Voraussetzungen: CoinGecko-ID am Instrument (z. B. „bitcoin“), COINGECKO_API_KEY (kostenloser Demo-Schlüssel), Aktualisierung.</Empty>}
          </Card>
        )}

        <Card title="Fundamentaldaten (SEC, Jahreswerte)" className="xl:col-span-2">
          {isCrypto ? <Empty>Für Krypto nicht anwendbar.</Empty> : a.fundamentals.count === 0 ? (
            <Empty>Keine Fundamentaldaten. Quelle: SEC EDGAR (SEC_USER_AGENT setzen, dann Aktualisierung). Analystenschätzungen/Forward-KGV benötigen einen zusätzlichen Provider oder manuelle Eingabe im Bewertungsmodell.</Empty>
          ) : (
            <>
              <Table head={["Geschäftsjahr bis", "Umsatz", "Nettogewinn (GAAP)", "eingereicht", "Beleg"]}>
                {a.fundamentals.revenue.map((r, i) => <tr key={r.id}><td>{dateDe(r.periodEnd)}</td><td className="num">{compact(r.value, r.unit)}</td><td className="num">{compact(a.fundamentals.netIncome[i]?.value, "USD")}</td><td>{dateDe(r.filedAt)}</td><td className="text-xs text-ink-3">{r.sourceRef}</td></tr>)}
              </Table>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                <div>Umsatzwachstum: <b>{pct(a.fundamentals.revGrowth)}</b> <span className="text-xs text-ink-3">(Vorjahr {pct(a.fundamentals.prevRevGrowth)})</span></div>
                <div>Freier Cashflow: <b>{compact(a.fundamentals.fcf, "USD")}</b></div>
                <div>FCF-Rendite: <b>{pct(a.fundamentals.fcfYield, 1, false)}</b></div>
                <div>SBC: <b>{compact(a.fundamentals.sbc?.value, "USD")}</b></div>
                <div>Verwässerung (Aktien): <b>{pct(a.fundamentals.dilution)}</b></div>
                <div>Rückkäufe: <b>{compact(a.fundamentals.buybacks?.value, "USD")}</b></div>
                <div>Cash / LT-Schulden: <b>{compact(a.fundamentals.cash?.value, "USD")} / {compact(a.fundamentals.debt?.value, "USD")}</b></div>
                <div>Börsenwert (Kurs × Aktien): <b>{compact(a.fundamentals.marketCap, "USD")}</b></div>
              </div>
            </>
          )}
          {!isCrypto && <p className="mt-2 text-sm">Forward-KGV (FY1): <b>{num(a.fundamentals.forwardPe, 1)}</b> <span className="text-xs text-ink-3">{a.fundamentals.forwardPeSource ? `(${a.fundamentals.forwardPeSource})` : "(keine Schätzung)"}</span> · PEG: <b>{a.fundamentals.peg.value != null ? `${num(a.fundamentals.peg.value, 2)} (${classifyPeg(a.fundamentals.peg.value, a.cfg.pegCheapBelow, a.cfg.pegExpensiveAbove)})` : <Missing>{a.fundamentals.peg.reason}</Missing>}</b></p>}
          {a.fundamentals.suitability.length > 0 && <div className="mt-2 text-xs text-warn">{a.fundamentals.suitability.map((s) => <p key={s.metric}>▲ {s.metric}: {s.reason}</p>)}</div>}
          <p className="mt-2 text-[11px] text-ink-3">Referenzheuristiken (grobe Orientierung): Umsatzwachstum ≥ {a.cfg.revenueGrowthMinPct} %, Ziel {a.cfg.revenueGrowthTargetLowPct}–{a.cfg.revenueGrowthTargetHighPct} %; PEG &lt; {a.cfg.pegCheapBelow} potenziell günstig, &gt; {a.cfg.pegExpensiveAbove} möglicherweise teuer; FCF-Rendite ab ca. {a.cfg.fcfYieldInterestingPct} % interessant; EV/Sales {a.cfg.evSalesRefLow}–{a.cfg.evSalesRefHigh} als grober Bereich bei unprofitablen Wachstumswerten. Bereinigte Gewinne auf SBC prüfen.</p>
        </Card>
      </div>

      {!isCrypto && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <Card title="Fair Value – drei Szenarien">
            {a.valuation.scenarios.length ? (
              <>
                {a.valuation.scenarios.map((s) => (
                  <div key={s.horizon} className="mb-3">
                    <h3 className="text-xs font-semibold">{s.horizon} (Zieljahr {s.year})</h3>
                    <Table head={["Szenario", "Umsatz", "Marge", "EPS", "KGV", "Fair Value", "vs. Kurs"]}>
                      {s.results.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num">{compact(r.revenue)}</td><td className="num">{pct(r.assumptions.netMarginPct, 1, false)}</td><td className="num">{num(r.eps)}</td><td className="num">{num(r.assumptions.fairPe, 1)}</td><td className="num font-medium">{money(r.fairValue, v!.currency)}</td><td className="num">{a.price ? pct(((a.price - r.fairValue) / r.fairValue) * 100) : "–"}</td></tr>)}
                    </Table>
                  </div>
                ))}
                <p className="text-[11px] text-ink-3">Fair Value = EPS × faires KGV; EPS = Umsatz × Marge ÷ Aktien (mit Verwässerung). Quelle der Annahmen: {v?.source}. Kurs und Fair Value sind getrennt; große Modellunsicherheit.{a.valuation.currencyMismatch && " Währung des Modells ≠ Handelswährung – kein Vergleich mit dem Kurs."}</p>
              </>
            ) : <Empty>Noch kein Bewertungsmodell – Annahmen unten eingeben.</Empty>}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-accent">Annahmen bearbeiten</summary>
              <ActionForm action={saveValuation} className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                <input type="hidden" name="instrumentId" value={inst.id} />
                <Field label="Basisjahr"><input name="baseYear" defaultValue={v?.baseYear ?? Number(a.today.slice(0, 4)) - 1} /></Field>
                <Field label="Umsatz Basisjahr"><input name="revenue" defaultValue={v?.revenue ?? a.fundamentals.revenue[0]?.value ?? ""} /></Field>
                <Field label="Verwässerte Aktien"><input name="shares" defaultValue={v?.sharesOutstanding ?? a.fundamentals.shares[0]?.value ?? ""} /></Field>
                <Field label="Währung"><input name="currency" defaultValue={v?.currency ?? cur} /></Field>
                <Field label="EPS-Schätzung FY1"><input name="epsForward" defaultValue={v?.epsForward ?? ""} /></Field>
                <Field label="EPS-Wachstum % (für PEG)"><input name="epsGrowth" defaultValue={v?.epsGrowthPct ?? ""} /></Field>
                <Field label="Abzinsung % (optional)"><input name="discount" defaultValue={v?.discountRatePct ?? ""} /></Field>
                <Field label="Quelle der Annahmen"><input name="source" defaultValue={v?.source ?? "eigene Annahme"} /></Field>
                {(["konservativ", "basis", "optimistisch"] as const).map((l) => (
                  <fieldset key={l} className="col-span-2 grid grid-cols-4 gap-2 rounded border border-line p-2 md:col-span-4">
                    <legend className="px-1 text-xs">{l}</legend>
                    <Field label="Wachstum % p. a."><input name={`${l}_g`} defaultValue={sc(l)?.revenueGrowthPct ?? ({ konservativ: 5, basis: 10, optimistisch: 15 }[l])} /></Field>
                    <Field label="Nettomarge %"><input name={`${l}_m`} defaultValue={sc(l)?.netMarginPct ?? ""} /></Field>
                    <Field label="Verwässerung % p. a."><input name={`${l}_d`} defaultValue={sc(l)?.annualDilutionPct ?? 0} /></Field>
                    <Field label="Faires KGV"><input name={`${l}_pe`} defaultValue={sc(l)?.fairPe ?? ""} /></Field>
                  </fieldset>
                ))}
              </ActionForm>
            </details>
          </Card>
          <Card title="Rückwärtsrechnung: Was steckt im Kurs?">
            <ReverseValuation marketCap={a.fundamentals.marketCap} revenue={a.fundamentals.revenue[0]?.value ?? null} currency={cur} />
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Termine">
          <ul className="space-y-1 text-sm">
            {a.earnings.map((e) => <li key={e.id}>Quartalszahlen {dateDe(e.reportDate)} {e.timeOfDay && `(${e.timeOfDay})`} {e.dateIsEstimated && <Badge tone="warn">vom Provider gemeldet, nicht vom Unternehmen bestätigt</Badge>} <span className="text-xs text-ink-3">EPS-Schätzung {num(e.epsEstimate)} · {e.provider}</span></li>)}
            {!a.earnings.length && <li className="text-ink-3">Kein Quartalstermin abgerufen</li>}
            {fomc.map((m) => <li key={m.end}>FOMC-Entscheidung {dateDe(m.end)}{m.tentative ? " (vorläufig)" : ""}</li>)}
          </ul>
          <p className="mt-2 text-[11px] text-ink-3">Referenzregel: ca. {a.cfg.earningsWindowDays} Tage vor Zahlen keine größeren Neupositionen; ggf. kleine Testposition.</p>
        </Card>
        <Card title="Analystenmaßnahmen (manuell/Provider)">
          <ul className="text-xs">{a.actions.map((x) => <li key={x.id}>{dateDe(x.date)} {x.firm} {x.action} {x.priceTarget ? `Ziel ${money(x.priceTarget, cur)}` : ""} <span className="text-ink-3">({x.provider})</span></li>)}{!a.actions.length && <li className="text-ink-3">Keine Daten – kein Analysten-Provider angebunden.</li>}</ul>
          <form action={addAnalystAction} className="mt-2 grid grid-cols-2 gap-1 text-xs"><input type="hidden" name="instrumentId" value={inst.id} /><input type="date" name="date" defaultValue={a.today} /><select name="action"><option value="DOWNGRADE">Herabstufung</option><option value="UPGRADE">Heraufstufung</option><option value="TARGET_CHANGE">Kursziel</option><option value="INIT">Erstbewertung</option><option value="REITERATE">Bestätigung</option></select><input name="firm" placeholder="Haus" /><input name="priceTarget" placeholder="Kursziel" /><button className="col-span-2 rounded border border-line">Erfassen</button></form>
          <p className="mt-2 text-[11px] text-ink-3">Sehr positive Stimmung kann bedeuten, dass Erwartungen eingepreist sind (Hinweis, keine Verkaufsregel).</p>
        </Card>
        <Card title="Kontext: Politikermeldungen">
          <p className="text-xs text-ink-2">Ergänzende Information mit Meldeverzögerung – kein Kaufgrund, keine Unterstellung von Motiven.</p>
          <ul className="mt-2 text-xs">{a.politicians.map((p) => <li key={p.id}>{dateDe(p.transactionDate)} {p.politicianName} ({p.chamber}) {p.txType} {p.amountText} · eingereicht {dateDe(p.filedDate)}</li>)}{!a.politicians.length && <li className="text-ink-3">Keine Politikermeldungen zu diesem Ticker erfasst.</li>}</ul>
          {a.politicians.length > 0 && <Link className="text-xs text-accent" href={`/politiker?ticker=${inst.symbol}`}>Alle Meldungen →</Link>}
        </Card>
      </div>

      {!isCrypto && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card title="Analystenschätzungen (Konsens)">
            {a.fundamentals.estimates.all.length ? (
              <>
                <Table head={["Periode bis", "EPS Ø", "Spanne", "Analysten", "Rev. ↑/↓ 30 T."]}>
                  {a.fundamentals.estimates.all.filter((e) => e.horizon === "FY" || e.periodEnd > a.today).slice(0, 5).map((e) => <tr key={e.horizon + e.periodEnd} className={e.periodEnd === a.fundamentals.estimates.fwd.fy1?.periodEnd ? "font-medium" : ""}><td>{e.horizon === "FY" ? "GJ" : "Q"} {dateDe(e.periodEnd)}{e.periodEnd === a.fundamentals.estimates.fwd.fy1?.periodEnd && " (FY1)"}</td><td className="num">{num(e.eps)}</td><td className="num text-xs">{num(e.epsLow)}–{num(e.epsHigh)}</td><td className="num">{num(e.analysts, 0)}</td><td className="num">{num(e.revisionsUp30d, 0)} / {num(e.revisionsDown30d, 0)}</td></tr>)}
                </Table>
                <p className="mt-2 text-xs">Erwartetes EPS-Wachstum: <b>{pct(a.fundamentals.estimates.fwd.growthPct)}</b> <span className="text-ink-3">({a.fundamentals.estimates.fwd.growthBasis ?? "–"})</span> · Revision FY1 (30 T.): {pct(a.fundamentals.estimates.fwd.revision30dPct, 2)}</p>
                <p className="mt-1 text-[11px] text-ink-3">Quelle {a.fundamentals.estimates.meta?.provider}, Stand {dateTimeDe(a.fundamentals.estimates.meta?.fetchedAt ?? null)}. Schätzungen, keine Fakten; sehr positive Erwartungen können eingepreist sein. Historische Schätzungen ggf. nicht split-bereinigt.</p>
              </>
            ) : <Empty>Keine Konsensschätzungen (Alpha Vantage EARNINGS_ESTIMATES; Zugang fehlt).</Empty>}
          </Card>
          <Card title="Insidertransaktionen (Form 4)">
            {a.insider.length ? (
              <>
                <p className="text-xs">Letzte 90 Tage: <b>{a.insiderSummary.openMarketBuys}</b> Käufe am offenen Markt · {a.insiderSummary.openMarketSells} Verkäufe · {a.insiderSummary.other} sonstige (Ausübung, Steuereinbehalt, Zuteilung, Schenkung)</p>
                <ul className="mt-2 max-h-56 overflow-auto text-xs">{a.insider.map((t) => { const [kind, code] = t.type.split("|"); return <li key={t.id} className="border-b border-line py-0.5">{dateDe(t.transactionDate)} · {t.insiderName} <span className="text-ink-3">({t.role})</span> · <span className={kind === "KAUF" ? "text-good" : kind === "VERKAUF" ? "text-bad" : ""}>{FORM4_CODES[code ?? ""]?.label ?? code}</span> · {qty(t.shares)} Stk.{t.price != null ? ` @ ${money(t.price, cur)}` : ""}</li>; })}</ul>
                <p className="mt-1 text-[11px] text-ink-3">Transaktionsdatum laut Quelle ({a.insider[0]?.provider}); Meldedatum wird nicht geliefert (Form 4 i. d. R. binnen 2 Geschäftstagen). Nur Käufe am offenen Markt (Code P) sind Insiderkäufe im engeren Sinn – ergänzende Information, kein Kaufgrund.</p>
              </>
            ) : <Empty>Keine Insiderdaten (Alpha Vantage INSIDER_TRANSACTIONS; Zugang fehlt).</Empty>}
          </Card>
          <Card title="Institutionelle Beteiligungen (13F)">
            {a.instSummary ? (
              <>
                <p className="text-sm">{num(a.instSummary.holders, 0)} Institutionen · Anteil {pct(a.instSummary.ownershipPct, 0, false)}</p>
                <p className="text-xs">Aufgestockt: {num(a.instSummary.increased, 0)} · reduziert: {num(a.instSummary.decreased, 0)} · netto {num((a.instSummary.netSharesChange ?? 0) / 1e6, 1)} Mio. Aktien</p>
                <ul className="mt-2 text-xs">{a.instSummary.holdings.slice(0, 8).map((h) => <li key={h.holder}>{h.holder}: {num((h.shares ?? 0) / 1e6, 1)} Mio. ({h.changeType}, Stichtag {dateDe(h.reportPeriod)})</li>)}</ul>
                {a.instSummary.mixedPeriods && <p className="mt-1"><Badge tone="warn">Unterschiedliche Stichtage: {a.instSummary.reportPeriods.map(dateDe).join(", ")}</Badge></p>}
                <p className="mt-1 text-[11px] text-ink-3">13F-Meldungen erscheinen bis 45 Tage nach Quartalsende und zeigen nicht den aktuellen Bestand. Quelle {a.instSummary.provider}, Abruf {dateTimeDe(a.instSummary.fetchedAt)}{a.instSummary.truncated ? ", Liste gekürzt" : ""}.</p>
              </>
            ) : <Empty>Keine 13F-Daten (Alpha Vantage INSTITUTIONAL_HOLDINGS; Zugang fehlt).</Empty>}
          </Card>
        </div>
      )}

      <Card title={`Regelwerk (${rules.outcomes.filter((o) => o.status === "AUSGELÖST").length} ausgelöst)`} className="mt-4">
        <Table head={["Regel", "Status", "Ergebnis", "Schwelle", "Mögliche Reaktion", "Grenzen", "Herkunft"]}>
          {rules.outcomes.map((o) => (
            <tr key={o.id}>
              <td className="text-xs"><b>{o.id}</b><div>{o.title}</div></td>
              <td><Badge tone={ruleTone(o.status, o.direction)}>{o.status.replace("_", " ")}{o.status === "AUSGELÖST" ? ` · ${o.direction}` : ""}</Badge></td>
              <td className="text-xs">{o.message}</td>
              <td className="text-xs text-ink-2">{o.threshold}</td>
              <td className="text-xs text-ink-2">{o.reaction}</td>
              <td className="text-xs text-ink-3">{o.limitations}</td>
              <td className="text-[11px] text-ink-3">{o.origin === "FINANZWIESEL_REFERENZ" ? "Referenzzusammenstellung" : "Dashboard-Erweiterung"}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Historische Prüfung der Signale (Backtest)" className="mt-4">
        <Table head={["Signal", "Status", "Stichprobe", "Ø Rendite", "Median", "Trefferquote", "Basisrate (alle Tage)", "Zeitraum"]}>
          {a.backtests.map((b) => (
            <tr key={b.label}>
              <td className="text-xs">{b.label}</td>
              <td>{b.r ? <Badge tone={b.r.status === "OK" ? "info" : "warn"}>{b.r.status.replace("_", " ")}</Badge> : <Badge tone="warn">keine Daten</Badge>}<div className="text-[11px] text-ink-3">{b.r?.reason ?? b.note}</div></td>
              <td className="num">{b.r?.sampleSize ?? "–"}</td>
              <td className="num">{b.r?.status === "OK" ? pct(b.r.avgReturnPct) : "–"}</td>
              <td className="num">{b.r?.status === "OK" ? pct(b.r.medianReturnPct) : "–"}</td>
              <td className="num">{b.r?.status === "OK" ? pct(b.r.hitRatePct, 0, false) : "–"}</td>
              <td className="num">{b.r?.status === "OK" ? pct(b.r.baselineAvgPct) : "–"}</td>
              <td className="text-xs">{b.r ? `${dateDe(b.r.period.from)}–${dateDe(b.r.period.to)}` : "–"}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-[11px] text-ink-3">{a.backtests.find((b) => b.r)?.r?.method} Grenzen: ein Titel (Survivorship-Bias der Auswahl), keine Steuern/Slippage, Fundamentaldaten- und Analystenregeln nicht enthalten. Positives Ergebnis ist kein Beweis für zukünftigen Erfolg.</p>
      </Card>

      <Card title="Thesen-Tagebuch" className="mt-4">
        <ul className="text-xs">{inst.thesisEvents.map((e) => <li key={e.id}>{dateDe(e.date)} · {e.kind} · {e.text}</li>)}{!inst.thesisEvents.length && <li className="text-ink-3">Noch keine Einträge</li>}</ul>
        <form action={addThesisEvent} className="mt-2 flex flex-wrap gap-2 text-xs"><input type="hidden" name="instrumentId" value={inst.id} /><select name="kind"><option value="POSITIV">positive Entwicklung</option><option value="NEGATIV">negative Entwicklung</option><option value="EREIGNIS">Ereignis</option><option value="THESE_VERLETZT">These verletzt</option></select><input name="text" className="min-w-64 flex-1" placeholder="Beobachtung" /><button className="rounded border border-line px-2">Eintragen</button></form>
      </Card>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
