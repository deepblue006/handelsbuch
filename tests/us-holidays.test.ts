import { describe, it, expect } from "vitest";
import { nyseHolidays, easterSunday, isNyseTradingDay } from "@/lib/calc/us-holidays";
import { lastUsCloseCutoff, lastWeekCloseCutoff, isDue } from "@/lib/providers/av-plan";

describe("NYSE-Feiertage (regelbasiert)", () => {
  it("2026 entspricht dem veröffentlichten NYSE-Kalender", () => {
    expect([...nyseHolidays(2026).keys()].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]);
  });
  it("2027: Wochenendregel (Juneteenth/Weihnachten am Samstag → Freitag, 4. Juli am Sonntag → Montag)", () => {
    expect([...nyseHolidays(2027).keys()].sort()).toEqual([
      "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
    ]);
  });
  it("Neujahr am Samstag hat keinen Ersatztag (31.12.2021 war Handelstag); Juneteenth erst ab 2022", () => {
    expect(isNyseTradingDay("2021-12-31")).toBe(true);
    expect(nyseHolidays(2022).has("2021-12-31")).toBe(false);
    expect([...nyseHolidays(2021).values()]).not.toContain("Juneteenth");
  });
  it("Ostersonntag", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2038)).toBe("2038-04-25");
  });
  it("außerplanmäßige Schließungen sind bewusst nicht enthalten (z. B. Staatstrauer 09.01.2025)", () => {
    expect(isNyseTradingDay("2025-01-09")).toBe(true);
  });
});

describe("Abrufplan mit Feiertagen", () => {
  it("nach einem Feiertag gilt der letzte echte Handelstag als Handelsschluss", () => {
    // Dienstag nach Labor Day (07.09.2026), vor Handelsschluss → Freitag 04.09.
    expect(lastUsCloseCutoff(new Date("2026-09-08T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-09-04");
  });
  it("Karfreitag: Wochenschluss ist der Gründonnerstag; Tageskurse sind am Feiertag nicht erneut fällig", () => {
    expect(lastWeekCloseCutoff(new Date("2026-04-04T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-04-02");
    const fetchedThuEvening = new Date("2026-04-02T23:00:00Z");
    expect(isDue("daily", fetchedThuEvening, new Date("2026-04-03T23:30:00Z"))).toBe(false);
    expect(isDue("weekly", fetchedThuEvening, new Date("2026-04-04T12:00:00Z"))).toBe(false);
  });
  it("mitten in der Woche zählt der Schluss der Vorwoche", () => {
    expect(lastWeekCloseCutoff(new Date("2026-10-14T23:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-09");
  });
});
