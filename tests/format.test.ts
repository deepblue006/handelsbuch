import { describe, expect, it } from "vitest";
import { money, pct, dateDe, dateTimeDe, qty } from "@/lib/format";

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
    expect(dateTimeDe("2026-10-11T14:22:00Z")).toMatch(/11\.10\.2026, 16:22 MESZ|11\.10\.2026, 16:22 UTC\+2/);
  });
});
