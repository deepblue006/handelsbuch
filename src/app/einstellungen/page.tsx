import { prisma } from "@/lib/db";
import { PROVIDERS, configStatus } from "@/lib/providers/registry";
import { getRuleConfig, getScoreWeights, getGeneral } from "@/lib/settings";
import { RULES } from "@/lib/rules/engine";
import { COMPONENT_LABELS } from "@/lib/score/score";
import { Card, PageHeader, Badge, Table, Field } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { RefreshButton } from "@/components/refresh-button";
import { saveSettingsAction, toggleProvider } from "@/app/actions";
import { dateTimeDe } from "@/lib/format";
import { DEFAULT_RULE_CONFIG } from "@/lib/rules/config";

export const dynamic = "force-dynamic";

const VER_TONE = { LIVE_GETESTET: "good", FORMAT_VERIFIZIERT: "info", UNGEPRÜFT: "warn", NICHT_IMPLEMENTIERT: "neutral", NUR_LINK: "neutral" } as const;
const RULE_LABELS: Record<string, string> = {
  breadthWeakBelowPct: "A: Marktbreite schwach ab % unter SMA200", indexNearHighPct: "A: Index „nahe Hoch“ innerhalb %", referenceCashQuotaPct: "A: Referenz-Cashquote %", marketPullbackPct: "A: Marktrücksetzer %",
  rallyPct: "B: Anstieg % (nicht hinterherkaufen)", rallyWindowDays: "B: Anstiegsfenster Tage", selloffPct: "B: Abverkauf %", selloffWindowDays: "B: Abverkaufsfenster Tage", waitDaysAfterSelloff: "B: Wartezeit nach Abverkauf (Tage)",
  rebuyMark1Pct: "B: Nachkaufmarke 1 (% unter Einstand)", rebuyMark2Pct: "B: Nachkaufmarke 2 (%)", ruleOf20Pct: "B: Rule of 20 (%)",
  rsiOversold: "C: RSI überverkauft unter", rsiOverbought: "C: RSI überkauft über", near200dPct: "C: Nähe 200-Tage-Linie ±%",
  earningsWindowDays: "D: Tage vor Quartalszahlen", downgradeLookbackDays: "D: Rückblick Herabstufungen (Tage)", minScoreCompleteness: "Score: Mindestvollständigkeit (0–1)",
  goldReferenceMinPct: "Gold-Referenz min. %", goldReferenceMaxPct: "Gold-Referenz max. %", pegCheapBelow: "PEG günstig unter", pegExpensiveAbove: "PEG teuer über", fcfYieldInterestingPct: "FCF-Rendite interessant ab %",
  revenueGrowthMinPct: "Umsatzwachstum min. %", revenueGrowthTargetLowPct: "Umsatzwachstum Ziel von %", revenueGrowthTargetHighPct: "Umsatzwachstum Ziel bis %", evSalesRefLow: "EV/Sales Referenz von", evSalesRefHigh: "EV/Sales Referenz bis",
};

export default async function Einstellungen() {
  const [states, logs, rules, weights, general] = await Promise.all([prisma.providerState.findMany(), prisma.fetchLog.findMany({ orderBy: { startedAt: "desc" }, take: 60 }), getRuleConfig(), getScoreWeights(), getGeneral()]);
  const st = new Map(states.map((s) => [s.providerId, s]));
  return (
    <div>
      <PageHeader title="Datenquellen & Einstellungen" subtitle="Quellen lassen sich einzeln deaktivieren, ohne andere Module zu ändern. API-Schlüssel werden ausschließlich über Umgebungsvariablen gesetzt und nie angezeigt." actions={<RefreshButton />} />
      <Card title="Provider">
        <Table head={["Quelle", "Kategorien", "Verifikation", "Konfiguration", "Aktiv", "Letzter Erfolg / Fehler", "Kosten & Limits", "Bedingungen", "Felder / Lücken"]}>
          {PROVIDERS.map((p) => {
            const s = st.get(p.id);
            const cs = configStatus(p);
            const enabled = s ? s.enabled : p.defaultEnabled;
            return (
              <tr key={p.id}>
                <td className="text-xs"><b>{p.name}</b>{p.official && <div><Badge tone="info">offiziell</Badge></div>}{p.website && <div><a className="text-accent" href={p.website} target="_blank" rel="noreferrer">Website</a>{p.docsUrl && <> · <a className="text-accent" href={p.docsUrl} target="_blank" rel="noreferrer">Doku</a></>}</div>}</td>
                <td className="text-[11px]">{p.categories.join(", ")}</td>
                <td className="text-[11px]"><Badge tone={VER_TONE[p.verification]}>{p.verification.replace("_", " ")}</Badge><div className="mt-1 text-ink-3">{p.verificationNote}</div></td>
                <td className="text-[11px]">{cs.configured ? <Badge tone="good">konfiguriert</Badge> : <Badge tone="bad">Zugang fehlt: {cs.missingEnv.join(", ")}</Badge>}</td>
                <td>{p.implemented ? <form action={toggleProvider}><input type="hidden" name="providerId" value={p.id} /><input type="hidden" name="enabled" value={enabled ? "0" : "1"} /><button className="text-xs text-accent">{enabled ? "an → aus" : "aus → an"}</button></form> : <span className="text-[11px] text-ink-3">–</span>}</td>
                <td className="text-[11px]">{s?.lastSuccessAt ? <div className="text-good">● {dateTimeDe(s.lastSuccessAt)}</div> : <div className="text-ink-3">kein Erfolg</div>}{s?.lastError && <div className="text-bad">■ {dateTimeDe(s.lastErrorAt)}: {s.lastError.slice(0, 160)}</div>}</td>
                <td className="max-w-60 text-[11px] text-ink-2">{p.cost}<div className="text-ink-3">{p.rateLimit} · {p.updateFrequency} · {p.delay} · Historie: {p.history}</div></td>
                <td className="max-w-60 text-[11px] text-ink-2">{p.terms}</td>
                <td className="max-w-60 text-[11px]">{p.fields.join("; ")}{p.notProvided.length > 0 && <div className="text-warn">fehlt: {p.notProvided.join("; ")}</div>}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Allgemein">
          <ActionForm action={saveSettingsAction} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="kind" value="general" />
            <Field label="Basiswährung"><input name="baseCurrency" defaultValue={general.baseCurrency} /></Field>
            <Field label="Zeitzone"><input name="timezone" defaultValue={general.timezone} /></Field>
            <Field label="Monatsbudget"><input name="monthlyBudget" defaultValue={general.monthlyBudget} /></Field>
            <Field label="Ziel-Cashquote %"><input name="targetCashQuotaPct" defaultValue={general.targetCashQuotaPct} /></Field>
            <Field label="Max. Positionsgewicht % (Standard)"><input name="maxPositionWeightPct" defaultValue={general.maxPositionWeightPct} /></Field>
            <Field label="Krypto-Präferenz"><input name="cryptoPreference" defaultValue={general.cryptoPreference} /></Field>
            <div className="col-span-2"><Field label="Krypto-Präferenz-Notiz"><input name="cryptoPreferenceNote" defaultValue={general.cryptoPreferenceNote} /></Field></div>
          </ActionForm>
        </Card>
        <Card title="Score-Gewichte">
          <ActionForm action={saveSettingsAction} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="kind" value="scoreWeights" />
            {(Object.keys(weights) as (keyof typeof weights)[]).map((k) => <Field key={k} label={COMPONENT_LABELS[k]}><input name={k} defaultValue={weights[k]} /></Field>)}
          </ActionForm>
          <p className="mt-2 text-[11px] text-ink-3">Startgewichtung 20/20/15/15/15/5/10. Fehlende Komponenten werden transparent umverteilt, nicht neutral gewertet.</p>
        </Card>
        <Card title="Regeln (Übersicht)">
          <ul className="text-[11px]">{RULES.map((r) => <li key={r.id} className="border-b border-line py-1"><b>{r.id}</b> – {r.explanation} <span className="text-ink-3">Eingaben: {r.requiredInputs.join(", ")}</span></li>)}</ul>
        </Card>
      </div>

      <Card title="Schwellenwerte (Referenzwerte der Zusammenstellung als Startparameter)" className="mt-4">
        <ActionForm action={saveSettingsAction} className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <input type="hidden" name="kind" value="rules" />
          {(Object.keys(rules) as (keyof typeof rules)[]).map((k) => <Field key={k} label={RULE_LABELS[k] ?? k} hint={rules[k] !== DEFAULT_RULE_CONFIG[k] ? `Start: ${DEFAULT_RULE_CONFIG[k]}` : undefined}><input name={k} defaultValue={rules[k]} /></Field>)}
        </ActionForm>
      </Card>

      <Card title="Abrufprotokoll" className="mt-4" id="protokoll">
        <Table head={["Beginn", "Ende", "Provider", "Datensatz", "Status", "Erhalten", "Verarbeitet", "HTTP", "Fehler", "Nächster Versuch"]}>
          {logs.map((l) => <tr key={l.id}><td className="text-xs">{dateTimeDe(l.startedAt)}</td><td className="text-xs">{dateTimeDe(l.finishedAt)}</td><td>{l.providerId}</td><td className="text-xs">{l.dataset}</td><td><Badge tone={l.status === "SUCCESS" ? "good" : l.status === "FAILED" ? "bad" : "warn"}>{l.status}</Badge></td><td className="num">{l.recordsReceived}</td><td className="num">{l.recordsProcessed}</td><td>{l.httpStatus ?? ""}</td><td className="max-w-80 text-[11px] text-bad">{l.errorMessage}</td><td className="text-xs">{dateTimeDe(l.nextAttemptAt)}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}
