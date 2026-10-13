import { CG_ATTRIBUTION } from "@/lib/providers/coingecko";
import { marketOverview } from "@/lib/server/market";
import { assessFreshness } from "@/lib/data/quality";
import { Card, PageHeader, Badge, DataBadge, Empty, Table, SourceLine, Missing, Disclaimer } from "@/components/ui";
import { LinesChart } from "@/components/charts";
import { money, num, pct, dateDe, dateTimeDe, compact } from "@/lib/format";
import { FOMC_SOURCE_NOTE } from "@/lib/fomc";
import { ActionForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { saveExternalBreadth } from "@/app/actions";

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export const dynamic = "force-dynamic";

export default async function Markt() {
  const m = await marketOverview();
  const b = m.breadth;
  return (
    <div>
      <PageHeader title="Marktlage & Finanzwiesel-Kennzahlen" subtitle="Referenzwerte aus der Zusammenstellung „Marktdaten, die Finanzwiesel nutzt“ (Stand 11.10.2026) – dokumentierte Startparameter, keine Aussagen über Strategiequalität. Beobachtete Zusammenhänge sind keine bewiesenen Ursachen." />

      <Card title="Regel A – Marktlage">
        <div className="flex flex-wrap gap-2">
          {m.ruleA.triggered === null ? <Badge tone="warn">nicht auswertbar – Indexverlauf oder Marktbreite fehlt</Badge> : m.ruleA.triggered ? <Badge tone="bad">Warnsignal: Index nahe Hoch, &gt; {m.cfg.breadthWeakBelowPct} % der Titel unter SMA200</Badge> : <Badge tone="good">Keine schwache Marktbreite nahe Hoch</Badge>}
          {m.ruleA.pullback && <Badge tone="info">Rücksetzer ≥ {m.cfg.marketPullbackPct} % – schrittweisen Kapitaleinsatz prüfen</Badge>}
          {!m.ruleA.representative && b.current.evaluated > 0 && <Badge tone="warn">Universum zu klein ({b.current.evaluated} Titel) – nicht repräsentativ</Badge>}
          {m.ruleA.breadthSource && <Badge tone="neutral">Marktbreite: {m.ruleA.breadthSource}</Badge>}
        </div>
        <p className="mt-2 text-xs text-ink-2">Referenzreaktion: selektiver kaufen; Cashquote von ca. {m.cfg.referenceCashQuotaPct} % als Orientierung prüfen. Löst keine Transaktion aus. Schwellen unter „Einstellungen“ änderbar.</p>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {m.indices.map((i) => (
          <Card key={i.symbol} title={`${i.label} (${i.symbol})`}>
            {i.available ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-lg font-semibold">{money(i.last, i.currency ?? "USD")}</span>{i.stage?.stage && <Badge tone={i.stage.stage === 2 ? "good" : i.stage.stage === 4 ? "bad" : "warn"}>{i.stage.label}</Badge>}</div>
                <ul className="mt-2 space-y-0.5 text-xs">
                  <li>vs. 200-Tage-Linie: {i.sma200d != null ? pct(((i.last! - i.sma200d) / i.sma200d) * 100) : <Missing>nicht berechenbar ({i.dailyBars} Tageskurse)</Missing>}</li>
                  <li>vs. 40-Wochen-Linie (Näherung der 200-Tage-Linie): {i.ma40w != null ? pct(((i.last! - i.ma40w) / i.ma40w) * 100) : "–"}</li>
                  <li>vs. 30-Wochen-Linie: {i.ma30w != null ? pct(((i.last! - i.ma30w) / i.ma30w) * 100) : "–"}</li>
                  <li>Abstand zum Hoch: {pct(i.drawdownPct)} (Hoch {dateDe(i.highDate)}, im vorliegenden Zeitraum)</li>
                </ul>
                <div className="mt-2"><LinesChart height={180} data={i.weekly} series={[{ key: "close", label: "Wochenschluss", color: "var(--s1)" }, { key: "ma30", label: "30 W", color: "var(--s2)" }, { key: "ma40", label: "40 W", color: "var(--s7)", dashed: true, width: 1.5 }]} /></div>
                {i.splitWarnings.length > 0 && <Badge tone="warn">möglicher Split in Rohdaten</Badge>}
                <SourceLine provider={i.provider} dataDate={i.lastDate} fetchedAt={i.fetchedAt} extra={i.proxyNote} />
                <div className="mt-1"><DataBadge f={assessFreshness({ dataDate: i.lastDate, fetchedAt: i.fetchedAt, frequency: "weekly", today: m.today, isSnapshot: i.isSnapshot, isDemo: i.isDemo })} provider={i.provider} /></div>
              </>
            ) : <Empty>Keine Kurse für {i.symbol}. Alpha-Vantage-Key setzen und aktualisieren.</Empty>}
          </Card>
        ))}
      </div>

      <Card title="Marktbreite: Anteil der Aktien über der 200-Tage-Linie" className="mt-4">
        <p className="text-xs text-ink-2">{b.current.method}</p>
        <p className="mt-1 text-sm">Aktuell: {b.current.pctAbove != null ? <b>{pct(b.current.pctAbove, 1, false)} über / {pct(b.current.pctBelow, 1, false)} unter SMA200</b> : <Missing>nicht auswertbar</Missing>} · Universum {b.current.universeSize} Titel, davon {b.current.evaluated} auswertbar.</p>
        {b.current.evaluated > 0 && <div className="mt-2"><LinesChart height={180} data={b.history.map((h) => ({ date: h.date, pct: h.pctAbove }))} domain={[0, 100]} refLines={[{ y: 50, label: "50 %" }]} series={[{ key: "pct", label: "% über SMA200", color: "var(--s1)" }]} /></div>}
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-accent">Enthaltene Titel ({b.current.members.length})</summary>
          {b.current.members.length ? <Table head={["Titel", "Status", "Schluss", "SMA200", "Datum", "Grund"]}>{b.current.members.map((x) => <tr key={x.symbol}><td>{x.symbol}</td><td>{x.status}</td><td className="num">{num(x.close)}</td><td className="num">{num(x.sma200)}</td><td>{dateDe(x.date)}</td><td className="text-ink-3">{x.reason}</td></tr>)}</Table> : <p className="mt-1 text-ink-3">Kein Universum definiert. Titel im Kauf-Cockpit mit „zum Marktbreiten-Universum“ hinzufügen (für Aussagekraft ≥ 20, idealerweise die Indexmitglieder). Für 200-Tage-Linien werden ≥ 200 Tageskurse je Titel benötigt (Alpha Vantage Free liefert nur 100).</p>}
        </details>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-accent">Externe Marktbreite manuell erfassen (z. B. % S&amp;P-500-Titel über SMA200 aus einer Quelle deiner Wahl)</summary>
          <ActionForm action={saveExternalBreadth} submit="Speichern" className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Field label="Datenstand"><input type="date" name="date" defaultValue={m.today} /></Field>
            <Field label="Anteil über SMA200 (%)"><input name="pctAbove" inputMode="decimal" /></Field>
            <div className="col-span-2"><Field label="Quelle (Pflicht)"><input name="source" placeholder="z. B. Indikator XY, Anbieter, Datum der Ablesung" /></Field></div>
          </ActionForm>
          <p className="mt-1 text-[11px] text-ink-3">Wird für Regel A nur genutzt, wenn das eigene Universum nicht repräsentativ ist und der Wert höchstens 7 Tage alt ist. Aktuell: {b.external ? `${b.external.points.at(-1)?.value ?? "–"} % (${dateDe(b.external.points.at(-1)?.date)}, ${b.external.provider})` : "keiner"}.</p>
        </details>
      </Card>

      <Card title="Krypto-Gesamtmarkt (CoinGecko) – Kontext" className="mt-4" id="krypto-markt">
        {m.cryptoGlobal ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div>Marktkapitalisierung: <b>{compact(m.cryptoGlobal.totalMarketCap.eur ?? null, "EUR")}</b> <span className="text-xs text-ink-3">({compact(m.cryptoGlobal.totalMarketCap.usd ?? null, "USD")})</span></div>
              <div>Veränderung 24 h (USD): <b>{pct(m.cryptoGlobal.change24hUsdPct, 1)}</b></div>
              <div>Bitcoin-Dominanz: <b>{pct(m.cryptoGlobal.dominancePct.btc ?? null, 1, false)}</b></div>
              <div>Ethereum-Anteil: <b>{pct(m.cryptoGlobal.dominancePct.eth ?? null, 1, false)}</b></div>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">Stand laut CoinGecko: {dateTimeDe(m.cryptoGlobal.updatedAt)} (Anbieter aktualisiert alle 10 Minuten) · abgerufen {dateTimeDe(m.cryptoGlobal.fetchedAt)} · nur Kontext, kein Bestandteil des Regelwerks. <a className="text-accent" href={CG_ATTRIBUTION.url} target="_blank" rel="noreferrer">{CG_ATTRIBUTION.text}</a></p>
          </>
        ) : <Empty>Keine Daten. CoinGecko benötigt einen kostenlosen Demo-Schlüssel (COINGECKO_API_KEY) und eine Aktualisierung.</Empty>}
      </Card>

      {m.sectors && (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <Card title="Sektorrotation & relative Stärke (SPDR-Sektor-ETFs vs. SPY)" className="xl:col-span-2">
            <Table head={["Sektor", "4 W", "13 W", "26 W", "52 W", "relativ 13 W", "relativ 26 W", "Trend rel. Stärke"]}>
              {m.sectors.rows.slice().sort((a, b) => (b.relative[13] ?? -999) - (a.relative[13] ?? -999)).map((r) => (
                <tr key={r.symbol}>
                  <td>{r.label} <span className="text-ink-3">({r.symbol})</span></td>
                  {[4, 13, 26, 52].map((w) => <td key={w} className="num">{r.splitInWindow[w] ? <a href={`/asset/${r.symbol}#splits`}><Badge tone="warn">Split?</Badge></a> : pct(r.returns[w])}</td>)}
                  {[13, 26].map((w) => <td key={w} className={"num " + ((r.relative[w] ?? 0) >= 0 ? "text-good" : "text-bad")}>{r.relative[w] != null ? `${r.relative[w]! > 0 ? "+" : ""}${num(r.relative[w], 1)} Pp.` : "–"}</td>)}
                  <td className="text-xs">{r.rsTrend === "VERBESSERT" ? "▲ verbessert" : r.rsTrend === "VERSCHLECHTERT" ? "▼ verschlechtert" : r.rsTrend === "UNVERÄNDERT" ? "→ unverändert" : "–"}</td>
                </tr>
              ))}
            </Table>
            {m.sectors.splitNotes.length > 0 && <p className="mt-2 text-[11px] text-ink-3">Split-Bereinigung: {m.sectors.splitNotes.join(" · ")}</p>}
            {m.sectors.rows.some((r) => Object.values(r.splitInWindow).some(Boolean)) && <p className="mt-1 text-[11px] text-warn">„Split?“: Kurssprung wie bei einem Split, aber keine geprüfte Splitliste. Auf der Detailseite des ETFs Splits erfassen oder per Alpha Vantage (SPLITS) abrufen.</p>}
            <p className="mt-2 text-[11px] text-ink-3">{m.sectors.method} Echte Kapitalzu-/abflüsse in Sektor-ETFs sind nicht angebunden – Kursstärke ist kein Flussmaß.</p>
            <SourceLine provider={m.sectors.provider} dataDate={m.sectors.endDate} fetchedAt={m.sectors.fetchedAt} />
          </Card>
          <Card title="Saisonalität S&amp;P 500 (SPY) – nur Kontext">
            {m.sectors.seasonality.sufficient ? (
              <Table head={["Monat", "Ø", "Median", "positiv", "n"]}>
                {m.sectors.seasonality.stats.map((s) => <tr key={s.month} className={s.month === Number(m.today.slice(5, 7)) ? "font-semibold" : ""}><td>{MONTHS[s.month - 1]}</td><td className="num">{pct(s.avgPct, 1)}</td><td className="num">{pct(s.medianPct, 1)}</td><td className="num">{pct(s.positivePct, 0, false)}</td><td className="num">{s.n}</td></tr>)}
              </Table>
            ) : <Empty>Zu wenige Jahre für eine Saisonalitätsstatistik.</Empty>}
            <p className="mt-2 text-[11px] text-ink-3">Monatsrenditen aus dem letzten Wochenschluss je Monat ({m.sectors.seasonality.from}–{m.sectors.seasonality.to}), ohne Dividenden. Saisonalität löst für sich allein keinen Kauf aus und ist keine Prognose.</p>
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {m.cards.map((c) => (
          <Card key={c.id} title={c.title}>
            {c.series && c.last ? (
              <>
                <div className="flex items-baseline justify-between"><span className="text-lg font-semibold">{num(c.last.value, c.id === "eurusd" ? 4 : 2)} <span className="text-xs font-normal text-ink-2">{c.unitLabel}</span></span><DataBadge f={assessFreshness({ dataDate: c.last.date, fetchedAt: c.series.fetchedAt, frequency: c.series.frequency as "daily", today: m.today, isSnapshot: c.series.isSnapshot })} provider={c.series.provider} /></div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-2">{c.changes.map((x) => <span key={x.label}>{x.label}: {x.delta == null ? "–" : (x.delta > 0 ? "+" : "") + num(x.delta, c.id === "eurusd" ? 4 : 2)}</span>)}</div>
                <div className="mt-2"><LinesChart height={150} data={c.series.points.slice(-750).map((p) => ({ date: p.date, v: p.value }))} series={[{ key: "v", label: c.title, color: "var(--s1)" }]} /></div>
                {c.note && <p className="mt-1 text-xs text-ink-2">{c.note}</p>}
                <SourceLine provider={c.series.provider} dataDate={c.last.date} fetchedAt={c.series.fetchedAt} extra={c.series.originalSource ?? undefined} />
              </>
            ) : <Empty>Keine Daten ({c.id === "real" || c.id === "umcsent" || c.id === "debt" ? "Quelle: FRED – FRED_API_KEY setzen" : "Alpha Vantage oder FRED konfigurieren"}).</Empty>}
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Fed-Termine & Zinserwartungen">
          <ul className="text-sm">{m.fomc.map((f) => <li key={f.end}>{dateDe(f.start)}–{dateDe(f.end)}{f.sep ? " · mit Projektionen" : ""}{f.tentative ? " · vorläufig" : ""}</li>)}</ul>
          <p className="mt-1 text-[11px] text-ink-3">{FOMC_SOURCE_NOTE}</p>
          <h3 className="mt-3 text-xs font-semibold">Marktimplizierte Erwartungen</h3>
          {m.kalshi ? <ul className="text-xs">{m.kalshi.markets.slice(0, 8).map((k) => <li key={k.ticker}>{k.title} {k.subtitle}: {k.impliedPct != null ? `${num(k.impliedPct, 0)} %` : "–"} <span className="text-ink-3">({k.basis})</span></li>)}<li className="text-ink-3">Kalshi, Abruf {dateDe(m.kalshi.fetchedAt)} – Kontraktpreise, keine sichere Prognose</li></ul> : <p className="text-xs text-ink-3">Nicht verfügbar: CME FedWatch erfordert kostenpflichtigen Zugang; Kalshi-Adapter ist vorhanden, aber standardmäßig deaktiviert (Einstellungen).</p>}
        </Card>
        <Card title="Bewertungskontext">
          <p className="text-sm">Forward-KGV S&amp;P 500: <Missing>keine lizenzierte Quelle angebunden</Missing></p>
          <p className="mt-1 text-xs text-ink-3">Referenzzusammenstellung nannte damals ca. 21–22 – historische Momentaufnahme, kein aktueller Wert.</p>
          <p className="mt-3 text-sm">Buffett-Indikator (Näherung): {m.buffett?.last ? <b>{num(m.buffett.last.value, 0)} % ({dateDe(m.buffett.last.date)})</b> : <Missing>FRED-Daten fehlen</Missing>}</p>
          <p className="text-[11px] text-ink-3">{m.buffett?.method ?? "Marktwert Aktien (Fed Z.1) ÷ BIP – benötigt FRED_API_KEY."} Kontext, kein kurzfristiges Ein-/Ausstiegssignal.</p>
        </Card>
        <Card title="KI- und Sektorrisiken">
          <ul className="list-inside list-disc text-xs text-ink-2">
            <li>Stressszenario aus der Referenz: Rückgang bestimmter KI-Aktien um 30–40 % – als Szenario im Kaufplan simulierbar, keine Vorhersage.</li>
            <li>Hyperscaler-Capex, Halbleiterabhängigkeit, Strombedarf: offizielle Unternehmensdaten (10-K/10-Q via SEC) je Titel in der Detailseite.</li>
            <li>Sektorstärke: Kurse der SPDR-Sektor-ETFs (über Alpha Vantage, Wochenbasis) – siehe Sektorrotation. Fondsdaten von State Street (Beteiligungen, Flüsse) und Finviz-Gruppen sind nicht per API angebunden: <a className="text-accent" href="https://finviz.com/groups.ashx" rel="noreferrer" target="_blank">Finviz Gruppen</a>, <a className="text-accent" href="https://www.ssga.com/us/en/intermediary/etfs" rel="noreferrer" target="_blank">SPDR Sektor-ETFs</a>.</li>
          </ul>

        </Card>
      </div>
      <Card title="Saisonalität & Konsumentenstimmung" className="mt-4">
        <p className="text-xs text-ink-2">Saisonalität ist ausschließlich Kontext und löst für sich allein keinen Kauf aus. Konsumentenstimmung: siehe Karte „Konsumentenstimmung“ (FRED UMCSENT). Nach starken Abverkäufen prüft Regel B2 Herabstufungen und eine Wartezeit von {m.cfg.waitDaysAfterSelloff} Tagen.</p>
      </Card>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
