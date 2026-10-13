/** Einmalige Aktualisierung aller aktivierten Provider (z. B. per Cron). */
import { refreshAll } from "../src/lib/server/refresh";
import { prisma } from "../src/lib/db";

refreshAll()
  .then((r) => { for (const x of r) console.log(`${x.ok ? "OK  " : "FEHL"} ${x.provider.padEnd(14)} ${x.dataset.padEnd(24)} ${x.info}`); })
  .finally(() => prisma.$disconnect());
