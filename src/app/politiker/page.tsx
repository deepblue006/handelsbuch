import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RECORD_STATUS } from "@/lib/politics/normalize";
import { Card, PageHeader, Badge, Empty, Table, Field } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { markReviewed, ptrFromText, ptrFromPdf, createManualFiling } from "@/app/actions";
import { dateDe, dateTimeDe, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Politiker({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const PAGE = 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (n: number) => "/politiker?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]), page: String(n) }).toString();
  const where: Prisma.PoliticianTransactionWhereInput = { ...(sp.all ? {} : { isCurrent: true }) };
  if (sp.person) where.politicianName = { contains: sp.person, mode: "insensitive" };
  if (sp.ticker) where.ticker = sp.ticker.toUpperCase();
  if (sp.chamber) where.chamber = sp.chamber;
  if (sp.type) where.txType = sp.type;
  if (sp.kind) where.instrumentKind = sp.kind;
  if (sp.from || sp.to) where.transactionDate = { ...(sp.from ? { gte: new Date(sp.from) } : {}), ...(sp.to ? { lte: new Date(sp.to) } : {}) };
  if (sp.review) where.needsReview = true;
  const [txs, total, reviewCount, coverage, filings, held] = await Promise.all([
    prisma.politicianTransaction.findMany({ where, orderBy: [{ transactionDate: "desc" }, { id: "asc" }], take: PAGE, skip: (page - 1) * PAGE }),
    prisma.politicianTransaction.count({ where }),
    prisma.politicianTransaction.count({ where: { needsReview: true, isCurrent: true } }),
    prisma.sourceCoverage.findMany(),
    prisma.politicianFiling.findMany({ where: { transactions: { none: {} } }, orderBy: { filedDate: "desc" }, take: 20 }),
    prisma.instrument.findMany({ where: { transactions: { some: {} } }, select: { symbol: true } }),
  ]);
  const heldSet = new Set(held.map((h) => h.symbol));
  const history = sp.ticker || sp.person ? await prisma.politicianTransaction.findMany({ where: { isCurrent: false, ...(sp.ticker ? { ticker: sp.ticker.toUpperCase() } : {}), ...(sp.person ? { politicianName: { contains: sp.person, mode: "insensitive" } } : {}) }, take: 50 }) : [];

  return (
    <div>
      <PageHeader title="US-Politiker-Transaktionsradar" subtitle="Öffentlich gemeldete Transaktionen – Kontextinformation. Beträge sind gemeldete Spannen. Eine Meldung belegt keinen heutigen Bestand. Es werden keine Insiderkenntnisse oder Motive unterstellt; keine automatische Kaufempfehlung." />

      <Card title="Quellenabdeckung (keine Vollständigkeit behauptet)">
        <Table head={["Quelle", "Institution / Dokumenttyp", "Geprüfte Zeiträume", "Letzter Erfolg", "Gefunden", "Verarbeitet", "Transaktionen", "Ausstehend", "Lücken", "Letzter Fehler"]}>
          {coverage.map((c) => <tr key={c.id}><td>{c.provider}</td><td>{c.institution} · {c.docType}</td><td>{c.periodsChecked}</td><td>{dateTimeDe(c.lastSuccessAt)}</td><td className="num">{c.docsFound}</td><td className="num">{c.docsProcessed}</td><td className="num">{c.txExtracted}</td><td className="num">{c.docsPending}</td><td className="text-xs">{c.knownGaps}</td><td className="text-xs text-bad">{c.lastError ? `${c.lastError} (${dateTimeDe(c.lastErrorAt)})` : ""}</td></tr>)}
          <tr><td>senate_efd</td><td>US Senate eFD · PTR</td><td colSpan={8} className="text-xs text-ink-2">Nicht automatisiert (Nutzungsvereinbarung im Browser; Zulässigkeit automatisierter Abfragen ungeklärt). Originale: <a className="text-accent" href="https://efdsearch.senate.gov/search/" target="_blank" rel="noreferrer">efdsearch.senate.gov</a></td></tr>
          <tr><td>oge</td><td>Office of Government Ethics · 278e/278-T</td><td colSpan={8} className="text-xs text-ink-2">Nur Verlinkung: <a className="text-accent" href="https://www.oge.gov/" target="_blank" rel="noreferrer">oge.gov</a> · <a className="text-accent" href="https://www2.oge.gov/web/OGE.nsf/accessdocs_disclosure-faq" target="_blank" rel="noreferrer">Disclosure FAQ</a></td></tr>
        </Table>
        <p className="mt-2 text-[11px] text-ink-3">Offizielle Quellen: <a className="text-accent" href="https://disclosures-clerk.house.gov/FinancialDisclosure" target="_blank" rel="noreferrer">House Clerk</a>, <a className="text-accent" href="https://www.senate.gov/legislative/Public_Disclosure/financial-disclosure.htm" target="_blank" rel="noreferrer">Senate</a>. Sekundärquelle Alpha Vantage CONGRESS_TRADES: aggregiert, Originaldokument nicht geprüft. Gesetzliche Nutzungsbeschränkungen der Meldungen (u. a. keine kommerzielle Nutzung) beachten.</p>
      </Card>

      <Card title="Filter" className="mt-4">
        <form className="grid grid-cols-2 gap-2 md:grid-cols-8">
          <Field label="Person"><input name="person" defaultValue={sp.person} /></Field>
          <Field label="Ticker"><input name="ticker" defaultValue={sp.ticker} /></Field>
          <Field label="Kammer"><select name="chamber" defaultValue={sp.chamber ?? ""}><option value="">alle</option><option value="HOUSE">House</option><option value="SENATE">Senate</option></select></Field>
          <Field label="Art"><select name="type" defaultValue={sp.type ?? ""}><option value="">alle</option><option>KAUF</option><option>VERKAUF</option><option>TEILVERKAUF</option><option>TAUSCH</option><option>SONSTIGE</option></select></Field>
          <Field label="Instrument"><select name="kind" defaultValue={sp.kind ?? ""}><option value="">alle</option><option>AKTIE</option><option>OPTION</option><option>ANLEIHE</option><option>FONDS</option><option>KRYPTO</option><option>SONSTIGE</option><option>UNBEKANNT</option></select></Field>
          <Field label="Transaktion von"><input type="date" name="from" defaultValue={sp.from} /></Field>
          <Field label="bis"><input type="date" name="to" defaultValue={sp.to} /></Field>
          <div className="flex flex-col justify-end gap-1 text-xs"><label><input type="checkbox" name="review" defaultChecked={!!sp.review} /> nur Prüfwarteschlange</label><label><input type="checkbox" name="all" defaultChecked={!!sp.all} /> inkl. ersetzter Fassungen</label><button className="rounded-md border border-line py-1">Filtern</button></div>
        </form>
        <p className="mt-2 text-xs">{total} Treffer · Seite {page} von {Math.max(1, Math.ceil(total / PAGE))} {page > 1 && <Link className="text-accent" href={qs(page - 1)}>← zurück</Link>} {page * PAGE < total && <Link className="text-accent" href={qs(page + 1)}>weiter →</Link>} · <Link className="text-accent" href="/politiker?review=1">{reviewCount} in der manuellen Prüfwarteschlange</Link> · Eigene Positionen: {[...heldSet].map((s) => <Link key={s} className="mr-1 text-accent" href={`/politiker?ticker=${s}`}>{s}</Link>)}</p>
      </Card>

      <Card title="Meldungen" className="mt-4">
        {txs.length ? (
          <Table head={["Transaktion", "Benachrichtigt", "Eingereicht", "Veröffentlicht", "Person", "Eigentümer", "Wert", "Art", "Spanne", "Status", "Unsicherheiten", ""]}>
            {txs.map((t) => (
              <tr key={t.id} className={!t.isCurrent ? "opacity-60" : ""}>
                <td>{dateDe(t.transactionDate)}</td>
                <td>{dateDe(t.notificationDate)}</td>
                <td>{dateDe(t.filedDate)}</td>
                <td className="text-xs text-ink-3">{t.publishedDate ? dateDe(t.publishedDate) : `unbekannt (erfasst ${dateDe(t.createdAt)})`}</td>
                <td>{t.politicianName}<div className="text-[11px] text-ink-3">{t.chamber} {t.party ? `· ${t.party}` : ""} {t.state}</div></td>
                <td className="text-xs">{t.owner}</td>
                <td className="max-w-56">{t.ticker ? <span className={heldSet.has(t.ticker) ? "font-semibold" : ""}>{t.ticker}{heldSet.has(t.ticker) && " ★"}</span> : <Badge tone="warn">kein Ticker</Badge>}<div className="truncate text-[11px] text-ink-3" title={t.assetName}>{t.assetName}</div></td>
                <td className="text-xs">{t.txType}<div className="text-ink-3">{t.instrumentKind}</div></td>
                <td className="num text-xs">{t.amountMin != null ? money(t.amountMin, "USD", 0) : "?"} – {t.amountMax != null ? money(t.amountMax, "USD", 0) : "offen"}</td>
                <td className="text-xs"><Badge tone={t.status === "MANUELL_GEPRUEFT" ? "good" : t.status === "SEKUNDAERQUELLE" ? "info" : t.status === "KORRIGIERT_ODER_ERSETZT" ? "neutral" : "warn"}>{RECORD_STATUS[t.status as keyof typeof RECORD_STATUS] ?? t.status}</Badge>{t.version > 1 && <div className="text-[11px]">Fassung {t.version}</div>}{t.sourceFilingStatus && <div className="text-[11px] text-ink-3">Quelle: {t.sourceFilingStatus}</div>}</td>
                <td className="max-w-64 text-[11px] text-warn">{(t.uncertaintyFlags as string[]).map((f) => <div key={f}>▲ {f}</div>)}</td>
                <td>{t.needsReview && <form action={markReviewed}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-accent" title="Gegen Originaldokument geprüft">geprüft</button></form>}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Keine Meldungen für diesen Filter.</Empty>}
      </Card>

      {history.length > 0 && (
        <Card title="Versionshistorie (ersetzte Fassungen)" className="mt-4">
          <ul className="text-xs">{history.map((h) => <li key={h.id}>{dateDe(h.transactionDate)} {h.politicianName} {h.txType} {h.amountText} · eingereicht {dateDe(h.filedDate)} · Fassung {h.version} → ersetzt durch {h.supersededById ?? "Löschmeldung"}</li>)}</ul>
        </Card>
      )}

      <Card title="Offizielle PTR-Dokumente ohne extrahierte Transaktionen" className="mt-4">
        {filings.length ? (
          <div className="space-y-3">
            {filings.map((f) => (
              <details key={f.id} className="rounded border border-line p-2">
                <summary className="cursor-pointer text-sm">{f.filerName} · {f.stateDistrict} · eingereicht {dateDe(f.filedDate)} · DocID {f.docId}</summary>
                <p className="mt-1 text-xs"><a className="text-accent" href={f.sourceUrl ?? "#"} target="_blank" rel="noreferrer">Original-PDF öffnen</a> – Text aus dem PDF kopieren und hier einfügen. Die Extraktion wird mit Unsicherheiten markiert und muss manuell geprüft werden.</p>
                <ActionForm action={ptrFromPdf} submit="PDF auswerten" className="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="filingId" value={f.id} /><input type="file" name="pdf" accept="application/pdf" aria-label="Original-PDF" /></ActionForm>
                <ActionForm action={ptrFromText} submit="Text extrahieren" className="mt-2 flex flex-col gap-2"><input type="hidden" name="filingId" value={f.id} /><textarea name="text" rows={4} className="font-mono text-xs" placeholder="… oder Text aus dem PDF hier einfügen" /></ActionForm>
                {f.lastError && <p className="mt-1 text-xs text-warn">▲ {f.lastError}</p>}
              </details>
            ))}
          </div>
        ) : <Empty>Keine offenen Dokumente. Der Jahresindex des House Clerk wird bei der Aktualisierung geladen (Provider „house_clerk“); bis zu HOUSE_PDF_PER_RUN PDFs werden automatisch ausgewertet.</Empty>}
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-accent">Meldung manuell anlegen (z. B. Senate eFD, OGE)</summary>
          <ActionForm action={createManualFiling} submit="Anlegen" className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Field label="Kammer"><select name="chamber"><option value="SENATE">Senate</option><option value="HOUSE">House</option><option value="EXECUTIVE">Exekutive (OGE)</option></select></Field>
            <Field label="Name wie im Dokument"><input name="filerName" required /></Field>
            <Field label="Einreichungsdatum"><input type="date" name="filedDate" /></Field>
            <Field label="Dokument-ID"><input name="docId" /></Field>
            <Field label="Offizieller Link"><input name="sourceUrl" placeholder="https://efdsearch.senate.gov/…" /></Field>
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
