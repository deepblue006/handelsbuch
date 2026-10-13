import Link from "next/link";
import { prisma } from "@/lib/db";
import { analyzeAsset } from "@/lib/server/analysis";
import { Card, PageHeader, Badge, Empty, Table, Field, Missing, Disclaimer } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { addWatch } from "@/app/actions";
import { STATE_LABELS } from "@/lib/score/score";
import { money, num, pct, dateDe } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Cockpit({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const { sort = "score" } = await searchParams;
  const list = await prisma.instrument.findMany({ where: { OR: [{ onWatchlist: true }, { transactions: { some: {} } }] }, orderBy: { symbol: "asc" } });
  const rows = (await Promise.all(list.map((i) => analyzeAsset(i.symbol)))).filter((x): x is NonNullable<typeof x> => !!x);
  const sorters: Record<string, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    score: (a, b) => (b.score.total ?? -1) - (a.score.total ?? -1),
    symbol: (a, b) => a.inst.symbol.localeCompare(b.inst.symbol),
    completeness: (a, b) => b.score.completeness - a.score.completeness,
    rsi: (a, b) => (a.indicators.rsi14 ?? a.indicators.rsi14w ?? 999) - (b.indicators.rsi14 ?? b.indicators.rsi14w ?? 999),
    dist200: (a, b) => (a.indicators.dist200 ?? a.indicators.dist30w ?? 999) - (b.indicators.dist200 ?? b.indicators.dist30w ?? 999),
  };
  rows.sort(sorters[sort] ?? sorters.score!);
  const th = (key: string, label: string) => <Link href={`/cockpit?sort=${key}`} className={sort === key ? "text-ink underline" : ""}>{label}</Link>;

  return (
    <div>
      <PageHeader title="Kauf-Cockpit" subtitle="Watchlist und Bestände mit transparenter Kauf- bzw. Nachkaufprüfung. Der Score ist eine Orientierung; fehlende Daten werden nicht neutral gewertet." />
      <Card>
        {rows.length ? (
          <Table head={[th("symbol", "Wert"), "Kurs / Stand", th("score", "Score"), th("completeness", "Vollst."), "Zustand", "Stage", th("dist200", "Abst. 200T / 30W"), th("rsi", "RSI 14"), "Fair Value (Basis)", "Nächste Zahlen", "Gegenargumente"]}>
            {rows.map((a) => (
              <tr key={a.inst.id}>
                <td><Link href={`/asset/${a.inst.symbol}`} className="font-medium text-accent">{a.inst.symbol}</Link><div className="text-xs text-ink-3">{a.inst.name}{a.position ? " · im Bestand" : ""}</div></td>
                <td className="num">{money(a.price, a.inst.currency)}<div className="text-[11px] text-ink-3">{dateDe(a.priceDate)}</div></td>
                <td className="num">{a.score.total != null ? num(a.score.total, 0) : <Missing>–</Missing>}</td>
                <td className="num">{pct(a.score.completeness * 100, 0, false)}</td>
                <td><Badge tone={a.score.state.startsWith("MÖGLICHER") ? "good" : a.score.state === "ERHÖHTES_RISIKO" || a.score.state === "THESE_NEU_PRÜFEN" ? "bad" : "warn"}>{STATE_LABELS[a.score.state]}</Badge></td>
                <td>{a.stage?.stage ? `S${a.stage.stage}` : "–"}</td>
                <td className="num">{a.indicators.dist200 != null ? pct(a.indicators.dist200) + " (200T)" : a.indicators.dist30w != null ? pct(a.indicators.dist30w) + " (30W)" : "–"}</td>
                <td className="num">{a.indicators.rsi14 != null ? num(a.indicators.rsi14, 1) : a.indicators.rsi14w != null ? `${num(a.indicators.rsi14w, 1)} (W)` : "–"}</td>
                <td className="num">{a.valuation.fairValueBase != null ? money(a.valuation.fairValueBase, a.inst.currency) : <Missing>kein Modell</Missing>}</td>
                <td>{a.earnings[0] ? <>{dateDe(a.earnings[0].reportDate)}{a.rules.outcomes.find((o) => o.id === "D2_QUARTALSZAHLEN")?.status === "AUSGELÖST" && <> <Badge tone="warn">≤ {a.cfg.earningsWindowDays} T.</Badge></>}</> : <span className="text-ink-3">–</span>}</td>
                <td className="max-w-72 text-xs text-ink-2">{a.score.againstBuying.slice(0, 3).map((x) => <div key={x}>■ {x}</div>)}{a.rules.conflicts.length > 0 && <div className="text-warn">▲ {a.rules.conflicts.length} Regelkonflikt(e)</div>}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty>Watchlist leer.</Empty>}
      </Card>
      <Card title="Wert zur Watchlist hinzufügen" className="mt-4">
        <ActionForm action={addWatch} submit="Hinzufügen" className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Symbol (Heimatbörse)"><input name="symbol" required placeholder="MSFT" /></Field>
          <Field label="Name"><input name="name" /></Field>
          <Field label="Typ"><select name="assetType"><option value="STOCK">Aktie</option><option value="ETF">ETF</option><option value="CRYPTO">Krypto</option><option value="OTHER">Sonstige</option></select></Field>
          <Field label="Handelswährung"><input name="currency" defaultValue="USD" maxLength={3} /></Field>
          <Field label="Börse"><input name="exchange" placeholder="NASDAQ" /></Field>
          <Field label="Sektor"><input name="sector" /></Field>
          <Field label="CoinGecko-ID (Krypto)"><input name="coingeckoId" placeholder="bitcoin" /></Field>
          <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" name="breadth" /> zum Marktbreiten-Universum</label>
        </ActionForm>
      </Card>
      <div className="mt-4"><Disclaimer /></div>
    </div>
  );
}
