/**
 * Regelbasierte NYSE-Handelsfeiertage (ganztägige Schließungen).
 * Nicht enthalten: außerplanmäßige Schließungen (z. B. Staatstrauer, Unwetter) und verkürzte Handelstage.
 * Wochenendregel: Feiertag am Samstag → Freitag davor geschlossen, am Sonntag → Montag danach;
 * Ausnahme Neujahr am Samstag: kein Ersatztag (NYSE-Regel).
 */

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** n-ter Wochentag (0 = So … 6 = Sa) eines Monats; n = -1 für den letzten. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return iso(y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, m, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return iso(y, m, lastDay.getUTCDate() - back);
}

/** Ostersonntag (gregorianisch, Anonymer Algorithmus nach Meeus/Jones/Butcher). */
export function easterSunday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

function observed(y: number, m: number, d: number, allowFridayBefore = true): string | null {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 6) return allowFridayBefore ? iso(y, m, d - 1) : null;
  if (wd === 0) return iso(y, m, d + 1);
  return iso(y, m, d);
}

const cache = new Map<number, Map<string, string>>();

/** Feiertage eines Jahres: Datum → Bezeichnung. */
export function nyseHolidays(y: number): Map<string, string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const out = new Map<string, string>();
  const add = (date: string | null, name: string) => { if (date) out.set(date, name); };
  add(observed(y, 1, 1, false), "Neujahr");
  add(nthWeekday(y, 1, 1, 3), "Martin Luther King Jr. Day");
  add(nthWeekday(y, 2, 1, 3), "Washington's Birthday");
  const easter = new Date(easterSunday(y) + "T00:00:00Z");
  easter.setUTCDate(easter.getUTCDate() - 2);
  add(easter.toISOString().slice(0, 10), "Karfreitag");
  add(nthWeekday(y, 5, 1, -1), "Memorial Day");
  if (y >= 2022) add(observed(y, 6, 19), "Juneteenth");
  add(observed(y, 7, 4), "Independence Day");
  add(nthWeekday(y, 9, 1, 1), "Labor Day");
  add(nthWeekday(y, 11, 4, 4), "Thanksgiving");
  add(observed(y, 12, 25), "Weihnachten");
  cache.set(y, out);
  return out;
}

export function nyseHolidayName(dateIso: string): string | null {
  return nyseHolidays(Number(dateIso.slice(0, 4))).get(dateIso) ?? null;
}

/** Handelstag an der NYSE (Mo–Fr und kein regelbasierter Feiertag). */
export function isNyseTradingDay(dateIso: string): boolean {
  const wd = new Date(dateIso + "T00:00:00Z").getUTCDay();
  return wd !== 0 && wd !== 6 && !nyseHolidayName(dateIso);
}
