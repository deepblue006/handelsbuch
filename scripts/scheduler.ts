/**
 * Einfacher Scheduler: führt refreshAll in einem festen Intervall aus (Standard 6 h),
 * den Truth-Social-Feed zusätzlich alle TRUTHSOCIAL_REFRESH_MINUTES (Standard 15).
 * Tageskontingente werden je Provider über das Abrufprotokoll geprüft; bereits heute
 * erfolgreich geladene Datensätze werden übersprungen.
 */
import { refreshAll, refreshTruthSocial } from "../src/lib/server/refresh";

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

// Truth-Social-Feed separat und häufiger (Quelle prüft selbst nur alle paar Minuten → 15 min Standard, mindestens 5)
const truthMinutes = Math.max(5, Number(process.env.TRUTHSOCIAL_REFRESH_MINUTES ?? 15));
setInterval(() => {
  refreshTruthSocial().catch((e) => console.error(`[${new Date().toISOString()}] Truth-Social-Abruf`, (e as Error).message));
}, truthMinutes * 60_000);
