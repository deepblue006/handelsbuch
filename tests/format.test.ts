import { describe, expect, it } from "vitest";
import { money, moneyDual, pct, dateDe, dateTimeDe, qty } from "@/lib/format";

describe("Formatierung", () => {
  it("Beträge mit Währung, fehlende Werte als –", () => {
    expect(money(1234.5, "EUR").replace(/\s/g, " ")).toBe("1.234,50 €"); // Intl nutzt geschütztes Leerzeichen
    expect(money(1234.5, "USD")).toContain("$");
    expect(money(null, "EUR")).toBe("–");
    expect(pct(5)).toBe("+5,0 %");
    expect(qty(0.12345678)).toBe("0,12345678");
  });
  it("Zeitstempel mit Zeitzone", () => {
    expect(dateDe("2026-10-09")).toBe("09.10.2026");
    expect(dateTimeDe("2026-10-11T14:22:00Z")).toMatch(/^11\.10\.2026, 16:22 (MESZ|UTC\+2) · 10:22 ET$/);
    // abweichender Kalendertag in New York → mit Datum; Winterzeit (MEZ/EST) berücksichtigt
    expect(dateTimeDe("2026-12-01T02:30:00Z")).toMatch(/^01\.12\.2026, 03:30 (MEZ|UTC\+1) · 30\.11\., 21:30 ET$/);
    expect(dateTimeDe("2026-10-11T14:22:00Z", "Europe/Berlin", null)).not.toContain("ET");
    expect(dateTimeDe("ungültig")).toBe("–");
  });

  it("Euro-Beträge mit Dollarwert; Dollarbeträge unverändert; fehlender Kurs wird angezeigt statt geschätzt", () => {
    const fx = { usdPerEur: 1.12, date: "2026-10-09", source: "EZB" };
    expect(moneyDual(1000, "EUR", fx)).toMatch(/^1\.000,00\s€ \(≈ 1\.120,00\s\$\)$/);
    expect(moneyDual(336.64, "USD", fx)).toBe(money(336.64, "USD"));
    expect(moneyDual(1000, "EUR", { usdPerEur: null, date: null, source: null })).toMatch(/\(≈ – \$\)$/);
    expect(moneyDual(null, "EUR", fx)).toBe("–");
  });
});
