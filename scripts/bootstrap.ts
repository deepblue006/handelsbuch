/**
 * Legt die Basis-Instrumente für eine Live-Installation an (ohne Kurs- oder Demodaten):
 * Index-Proxys (SPY, QQQ, IWM) und die 11 SPDR-Sektor-ETFs. Idempotent.
 * Kurse kommen anschließend über die reguläre Aktualisierung (npm run refresh / Scheduler).
 */
import { prisma } from "../src/lib/db";
import { ensureInstrument } from "../src/lib/server/ingest";
import { INDEX_PROXIES, SECTOR_ETFS, SECTOR_ETF_TAG } from "../src/lib/server/market";

const PROXY_META: Record<string, { name: string; exchange: string }> = {
  SPY: { name: "SPDR S&P 500 ETF Trust (Proxy S&P 500)", exchange: "NYSE Arca" },
  QQQ: { name: "Invesco QQQ Trust (Proxy Nasdaq-100)", exchange: "NASDAQ" },
  IWM: { name: "iShares Russell 2000 ETF (Proxy Russell 2000)", exchange: "NYSE Arca" },
};

async function main() {
  let created = 0;
  for (const p of INDEX_PROXIES) {
    const before = await prisma.instrument.findUnique({ where: { symbol: p.symbol } });
    const meta = PROXY_META[p.symbol] ?? { name: p.label, exchange: null };
    await ensureInstrument({ symbol: p.symbol, name: meta.name, assetType: "INDEX_PROXY", currency: "USD", exchange: meta.exchange, providerIds: { alphavantage: p.symbol } });
    if (!before) created++;
  }
  for (const [sym, label] of SECTOR_ETFS) {
    const before = await prisma.instrument.findUnique({ where: { symbol: sym } });
    const inst = await ensureInstrument({ symbol: sym, name: `SPDR ${label} (Sektor-ETF)`, assetType: "ETF", currency: "USD", exchange: "NYSE Arca", sector: label, providerIds: { alphavantage: sym } });
    if (inst.industry !== SECTOR_ETF_TAG) await prisma.instrument.update({ where: { id: inst.id }, data: { industry: SECTOR_ETF_TAG } });
    if (!before) created++;
  }
  console.log(`Basis-Instrumente bereit (${created} neu angelegt, ${INDEX_PROXIES.length + SECTOR_ETFS.length} insgesamt).`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
