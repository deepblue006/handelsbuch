/**
 * FOMC-Termine. Quelle: Chicago Fed (Kalender 2026) und MNI (vorläufiger Plan 2027), abgeglichen am 11.10.2026.
 * Die offizielle Seite der Federal Reserve war aus der Entwicklungsumgebung nicht erreichbar – bitte gegenprüfen:
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 * Entscheidungen werden am zweiten Sitzungstag um 14:00 Uhr ET veröffentlicht.
 */
export interface FomcMeeting {
  start: string;
  end: string; // Entscheidungstag
  sep: boolean; // Summary of Economic Projections
  tentative: boolean;
}

export const FOMC_MEETINGS: FomcMeeting[] = [
  { start: "2026-01-27", end: "2026-01-28", sep: false, tentative: false },
  { start: "2026-03-17", end: "2026-03-18", sep: true, tentative: false },
  { start: "2026-04-28", end: "2026-04-29", sep: false, tentative: false },
  { start: "2026-06-16", end: "2026-06-17", sep: true, tentative: false },
  { start: "2026-07-28", end: "2026-07-29", sep: false, tentative: false },
  { start: "2026-09-15", end: "2026-09-16", sep: true, tentative: false },
  { start: "2026-10-27", end: "2026-10-28", sep: false, tentative: false },
  { start: "2026-12-08", end: "2026-12-09", sep: true, tentative: false },
  { start: "2027-01-26", end: "2027-01-27", sep: false, tentative: true },
  { start: "2027-03-16", end: "2027-03-17", sep: true, tentative: true },
  { start: "2027-04-27", end: "2027-04-28", sep: false, tentative: true },
  { start: "2027-06-08", end: "2027-06-09", sep: true, tentative: true },
  { start: "2027-07-27", end: "2027-07-28", sep: false, tentative: true },
  { start: "2027-09-14", end: "2027-09-15", sep: true, tentative: true },
  { start: "2027-10-26", end: "2027-10-27", sep: false, tentative: true },
  { start: "2027-12-07", end: "2027-12-08", sep: true, tentative: true },
];

export const FOMC_SOURCE_NOTE = "Statisch hinterlegt (Abgleich Chicago Fed/MNI am 11.10.2026, ungeprüft gegen federalreserve.gov). 2027 vorläufig.";

export function upcomingFomc(today: string, n = 3) {
  return FOMC_MEETINGS.filter((m) => m.end >= today).slice(0, n);
}
