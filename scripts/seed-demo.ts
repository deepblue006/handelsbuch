/**
 * Synthetisches Beispielportfolio – AUSSCHLIESSLICH zur Vorführung. Alle Datensätze tragen isDemo = true
 * und das Dashboard zeigt ein Demo-Banner. Entfernen: npm run db:seed:demo -- --remove
 */
import { prisma } from "../src/lib/db";
import { ensureInstrument } from "../src/lib/server/ingest";

async function remove() {
  await prisma.transaction.deleteMany({ where: { isDemo: true } });
  await prisma.cashMovement.deleteMany({ where: { isDemo: true } });
  await prisma.savingsPlan.deleteMany({ where: { isDemo: true } });
  await prisma.plannedTranche.deleteMany({ where: { isDemo: true } });
  await prisma.priceBar.deleteMany({ where: { isDemo: true } });
  await prisma.instrument.deleteMany({ where: { isDemo: true, transactions: { none: {} } } });
  console.log("Demodaten entfernt.");
}

async function main() {
  if (process.argv.includes("--remove")) return remove();
  if (await prisma.transaction.count({ where: { isDemo: false } })) {
    console.log("Es existieren echte Buchungen – Demodaten werden nicht hinzugefügt.");
    return;
  }
  const aapl = await ensureInstrument({ symbol: "AAPL", name: "Apple Inc.", assetType: "STOCK", currency: "USD", exchange: "NASDAQ", sector: "Technologie", onWatchlist: true });
  const btc = await ensureInstrument({ symbol: "BTC", name: "Bitcoin", assetType: "CRYPTO", currency: "EUR", exchange: "Börsenaggregat", providerIds: { coingecko: "bitcoin", alphavantage: "BTC" }, onWatchlist: true });
  const demoEtf = await ensureInstrument({ symbol: "DEMO-WELT", name: "Demo Welt-ETF (fiktiv)", assetType: "ETF", currency: "EUR", exchange: "XETRA", sector: "Breit gestreut", isDemo: true });
  const tx = [
    { instrumentId: aapl.id, side: "BUY" as const, tradeDate: "2024-03-12", quantity: 20, price: 172.5, priceCurrency: "USD", fees: 4.9, feeCurrency: "EUR", fxToBase: 0.915, note: "DEMO" },
    { instrumentId: aapl.id, side: "BUY" as const, tradeDate: "2025-04-08", quantity: 10, price: 198.0, priceCurrency: "USD", fees: 4.9, feeCurrency: "EUR", fxToBase: 0.905, note: "DEMO" },
    { instrumentId: btc.id, side: "BUY" as const, tradeDate: "2024-11-02", quantity: 0.15, price: 63000, priceCurrency: "EUR", fees: 9.5, feeCurrency: "EUR", fxToBase: 1, note: "DEMO" },
    { instrumentId: btc.id, side: "BUY" as const, tradeDate: "2026-02-15", quantity: 0.05, price: 81000, priceCurrency: "EUR", fees: 4.0, feeCurrency: "EUR", fxToBase: 1, note: "DEMO" },
    { instrumentId: demoEtf.id, side: "BUY" as const, tradeDate: "2025-01-15", quantity: 100, price: 95, priceCurrency: "EUR", fees: 1, feeCurrency: "EUR", fxToBase: 1, note: "DEMO" },
  ];
  for (const t of tx) await prisma.transaction.create({ data: { ...t, tradeDate: new Date(t.tradeDate + "T00:00:00Z"), isDemo: true, fxSource: "Demo" } });
  await prisma.cashMovement.create({ data: { date: new Date("2026-10-01T00:00:00Z"), type: "DEPOSIT", amount: 4000, currency: "EUR", note: "DEMO Liquidität", isDemo: true } });
  await prisma.priceBar.create({ data: { instrumentId: demoEtf.id, interval: "DAY", date: new Date("2026-10-09T00:00:00Z"), close: 104.2, currency: "EUR", provider: "demo", fetchedAt: new Date(), isDemo: true } });
  await prisma.savingsPlan.create({ data: { instrumentId: demoEtf.id, amount: 300, currency: "EUR", interval: "MONTHLY", dayOfMonth: 15, startDate: new Date("2025-01-15T00:00:00Z"), isDemo: true, note: "DEMO Sparplan" } });
  await prisma.positionMeta.upsert({ where: { instrumentId: aapl.id }, create: { instrumentId: aapl.id, thesis: "DEMO: Ökosystem und Services-Wachstum", thesisStatus: "INTAKT", horizon: "5+ Jahre", targetWeightPct: 12, maxWeightPct: 20, rebuyMarks: [{ price: 250, currency: "USD", label: "DEMO-Marke" }] }, update: {} });
  await prisma.positionMeta.upsert({ where: { instrumentId: btc.id }, create: { instrumentId: btc.id, preference: "HOLD_ONLY", preferenceNote: "Vorläufige Präferenz „nur halten“ (Entscheidung vom 08.10.2026) – editierbar, keine Automatik.", horizon: "langfristig" }, update: {} });
  console.log("Demodaten angelegt (isDemo = true).");
}
main().finally(() => prisma.$disconnect());
