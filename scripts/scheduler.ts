/**
 * Einfacher Scheduler: führt refreshAll in einem festen Intervall aus (Standard 6 h).
 * Tageskontingente werden je Provider über das Abrufprotokoll geprüft; bereits heute
 * erfolgreich geladene Datensätze werden übersprungen.
 */
import { refreshAll } from "../src/lib/server/refresh";

const hours = Number(process.env.REFRESH_INTERVAL_HOURS ?? 6);
async function tick() {
  const started = new Date();
  try {
    const r = await refreshAll();
    console.log(`[${started.toISOString()}] ${r.filter((x) => x.ok).length} ok, ${r.filter((x) => !x.ok).length} fehlgeschlagen`);
  } catch (e) {
    console.error(`[${started.toISOString()}] Scheduler-Fehler`, (e as Error).message);
  }
}
tick();
setInterval(tick, Math.max(1, hours) * 3600_000);
