import { test, expect } from "@playwright/test";

test("Übersicht kennzeichnet Demo- und Snapshotdaten", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "DEMODATEN AKTIV" })).toBeVisible();
  await expect(page.getByText("Snapshot · 09.10.2026").first()).toBeVisible();
  await expect(page.getByText("DEMO – keine Marktdaten").first()).toBeVisible();
});

test("Buchung erfassen: Fremdwährung ohne Wechselkurs wird angenommen, aber als unvollständig gekennzeichnet", async ({ page }) => {
  await page.goto("/portfolio");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Buchen" }) });
  await form.locator('input[name="symbol"]').fill("MSFT");
  await form.locator('input[name="name"]').fill("Microsoft");
  await form.locator('input[name="currency"]').fill("USD");
  await form.locator('input[name="quantity"]').fill("2");
  await form.locator('input[name="price"]').fill("400,50");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kauf MSFT gebucht" })).toBeVisible();
  await page.reload();
  const row = page.locator("tr", { hasText: "Microsoft" }).first();
  await expect(row).toContainText("Historischer Wechselkurs USD/EUR");
});

test("Verkauf über Bestand wird abgelehnt", async ({ page }) => {
  await page.goto("/portfolio");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Buchen" }) });
  await form.locator('select[name="side"]').selectOption("SELL");
  await form.locator('input[name="symbol"]').fill("AAPL");
  await form.locator('input[name="currency"]').fill("USD");
  await form.locator('input[name="quantity"]').fill("1000");
  await form.locator('input[name="price"]').fill("300");
  await form.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status").filter({ hasText: "nicht möglich" })).toBeVisible();
});

test("CSV-Import: Vorschau zeigt ungültige Zeilen, Import nur nach Bestätigung", async ({ page }) => {
  await page.goto("/portfolio");
  const csv = "datum;typ;symbol;name;assettyp;boerse;waehrung;menge;kurs;gebuehren;gebuehrenwaehrung;wechselkurs_zur_basis;notiz\n01.10.2026;Kauf;SAP;SAP SE;Aktie;XETRA;EUR;3;210,5;1;EUR;;Test\n01.10.2026;Tausch;X;X;Aktie;;EUR;1;1;;;;";
  await page.getByLabel("CSV-Inhalt").fill(csv);
  await page.getByRole("button", { name: "Vorschau prüfen" }).click();
  await expect(page.getByText("1 gültige, 1 ungültige Zeilen")).toBeVisible();
  await expect(page.getByText(/Typ unbekannt/)).toBeVisible();
  await page.getByRole("button", { name: "1 gültige Zeilen importieren" }).click();
  await expect(page.getByText(/1 Buchungen importiert, 1 Zeilen verworfen/)).toBeVisible();
});

test("Detailseite: transparente Prüfung mit fehlenden Daten statt Schätzung", async ({ page }) => {
  await page.goto("/asset/AAPL");
  await expect(page.getByRole("heading", { name: /AAPL/ })).toBeVisible();
  await expect(page.getByText("Datenlage nicht ausreichend").first()).toBeVisible();
  await expect(page.getByText(/braucht 200 Tageskurse/)).toBeVisible();
  await expect(page.getByText("D1_UEBER_FAIR_VALUE", { exact: true })).toBeVisible();
  await expect(page.getByText(/Möglicher unbereinigter Split|Stage 2/).first()).toBeVisible();
});

test("Bewertungsmodell speichern erzeugt drei Szenarien", async ({ page }) => {
  await page.goto("/asset/AAPL");
  await page.getByText("Annahmen bearbeiten").click();
  await page.locator('input[name="revenue"]').fill("400000000000");
  await page.locator('input[name="shares"]').fill("15000000000");
  for (const [l, m, pe] of [["konservativ", "22", "22"], ["basis", "25", "28"], ["optimistisch", "27", "32"]] as const) {
    await page.locator(`input[name="${l}_m"]`).fill(m);
    await page.locator(`input[name="${l}_pe"]`).fill(pe);
  }
  await page.getByRole("button", { name: "Speichern" }).last().click();
  await expect(page.getByText("Bewertungsannahmen gespeichert.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("cell", { name: "basis" }).first()).toBeVisible();
});

test("Truth Social täuscht keinen Live-Feed vor", async ({ page }) => {
  await page.goto("/truth-social");
  await expect(page.getByText("Keine zulässige Quelle konfiguriert")).toBeVisible();
  await expect(page.getByText("Keine Posts vorhanden – es wird kein Live-Feed vorgetäuscht.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Offizielles Profil/ })).toHaveAttribute("href", "https://truthsocial.com/@realDonaldTrump");
});

test("Einstellungen zeigen fehlende Zugänge ohne Secrets und lassen Quellen deaktivieren", async ({ page }) => {
  await page.goto("/einstellungen");
  await expect(page.getByText("Zugang fehlt: FRED_API_KEY")).toBeVisible();
  const row = page.locator("tr", { hasText: "Kalshi" });
  await row.getByRole("button", { name: "aus → an" }).click();
  await expect(page.locator("tr", { hasText: "Kalshi" }).getByRole("button", { name: "an → aus" })).toBeVisible();
});

test("Politiker-Radar: Filter und Prüfwarteschlange", async ({ page }) => {
  await page.goto("/politiker?person=Suozzi&all=1");
  await expect(page.getByText(/Treffer/)).toBeVisible();
  await expect(page.getByText("Korrigiert oder ersetzt").first()).toBeVisible();
  await page.goto("/politiker?review=1");
  await expect(page.getByText(/identische Zeilen/).first()).toBeVisible();
});
