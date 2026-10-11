import { describe, expect, it, vi } from "vitest";
import { assessFreshness, businessDaysBetween } from "@/lib/data/quality";
import { redact, stripSecretsForExport, looksLikeSecretMaterial } from "@/lib/security/redact";
import { fetchWithRetry, ProviderError, RateLimiter, backoffDelay } from "@/lib/providers/http";
import { configStatus, getProvider, PROVIDERS } from "@/lib/providers/registry";

describe("Datenaktualität", () => {
  it("Tagesschluss vom Freitag ist am Sonntag aktuell", () => {
    expect(businessDaysBetween("2026-10-09", "2026-10-11")).toBe(0);
    expect(assessFreshness({ dataDate: "2026-10-09", fetchedAt: "2026-10-11T10:00:00Z", frequency: "daily", today: "2026-10-11" }).state).toBe("AKTUELL");
  });
  it("verspätete und veraltete Daten", () => {
    expect(assessFreshness({ dataDate: "2026-10-06", fetchedAt: null, frequency: "daily", today: "2026-10-09" }).state).toBe("ZWISCHENGESPEICHERT");
    expect(assessFreshness({ dataDate: "2026-09-01", fetchedAt: null, frequency: "daily", today: "2026-10-09" }).state).toBe("VERALTET");
  });
  it("Demo, fehlend, Schätzung, Snapshot haben Vorrang bzw. eigene Kennzeichnung", () => {
    expect(assessFreshness({ dataDate: "2026-10-09", fetchedAt: null, frequency: "daily", today: "2026-10-09", isDemo: true }).label).toContain("DEMO");
    expect(assessFreshness({ dataDate: null, fetchedAt: null, frequency: "daily", today: "2026-10-09" }).state).toBe("FEHLT");
    expect(assessFreshness({ dataDate: "2026-10-09", fetchedAt: null, frequency: "daily", today: "2026-10-09", isEstimate: true }).state).toBe("GESCHÄTZT");
    expect(assessFreshness({ dataDate: "2026-10-09", fetchedAt: null, frequency: "daily", today: "2026-10-12", isSnapshot: true }).state).toBe("SNAPSHOT");
    expect(assessFreshness({ dataDate: "2026-10-09", fetchedAt: null, frequency: "daily", today: "2026-11-12", isSnapshot: true }).state).toBe("VERALTET");
  });
});

describe("Schutz vertraulicher Daten", () => {
  it("schwärzt API-Keys in URLs, Bearer-Tokens, DB-Passwörter und Umgebungswerte", () => {
    const s = redact("GET https://x/query?function=A&apikey=SECRET123&b=1 Authorization: Bearer abc.def postgresql://u:pw123@h/db token=ZZZ", { FRED_API_KEY: "fredkey-987654" });
    expect(s).not.toContain("SECRET123");
    expect(s).not.toContain("abc.def");
    expect(s).not.toContain("pw123");
    expect(s).not.toContain("ZZZ");
    expect(redact("Fehler mit fredkey-987654 im Text", { FRED_API_KEY: "fredkey-987654" })).not.toContain("fredkey-987654");
  });
  it("Exporte enthalten keine Secret-Felder", () => {
    const out = stripSecretsForExport({ a: 1, apiKey: "x", nested: { password: "p", ok: true, list: [{ token: "t", v: 2 }] } });
    expect(out).toEqual({ a: 1, nested: { ok: true, list: [{ v: 2 }] } });
  });
  it("erkennt Seed-Phrasen und private Schlüssel", () => {
    expect(looksLikeSecretMaterial("abandon ability able about above absent absorb abstract absurd abuse access accident")).toBe(true);
    expect(looksLikeSecretMaterial("-----BEGIN EC PRIVATE KEY-----")).toBe(true);
    expect(looksLikeSecretMaterial("Kauf nach Quartalszahlen, These intakt")).toBe(false);
  });
  it("Konfigurationsstatus nennt fehlende Variablen, aber nie Werte", () => {
    const st = configStatus(getProvider("fred"), { FRED_API_KEY: "" });
    expect(st.configured).toBe(false);
    expect(st.missingEnv).toEqual(["FRED_API_KEY"]);
    expect(JSON.stringify(configStatus(getProvider("fred"), { FRED_API_KEY: "geheim-123456" }))).not.toContain("geheim");
  });
  it("Register: jede Quelle hat Verifikationsstatus; nicht implementierte sind nicht standardmäßig aktiv", () => {
    for (const p of PROVIDERS) {
      expect(p.verificationNote.length).toBeGreaterThan(5);
      if (!p.implemented) expect(p.defaultEnabled).toBe(false);
    }
  });
});

describe("HTTP-Wiederholung und Limits", () => {
  const res = (status: number, body = "{}", headers: Record<string, string> = {}) => new Response(body, { status, headers });
  it("wiederholt bei 503 und 429 (Retry-After) und liefert dann Erfolg", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(429, "", { "retry-after": "2" })).mockResolvedValueOnce(res(200, '{"ok":1}'));
    const delays: number[] = [];
    const r = await fetchWithRetry("https://x?apikey=K", { fetchImpl: f as unknown as typeof fetch, sleep: async (ms) => { delays.push(ms); }, retries: 3, baseDelayMs: 100 });
    expect(await r.json()).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(delays[1]).toBe(2000);
  });
  it("kein Retry bei 404; Fehlermeldung ohne API-Key", async () => {
    const f = vi.fn().mockResolvedValue(res(404));
    await expect(fetchWithRetry("https://x?apikey=SECRETKEY", { fetchImpl: f as unknown as typeof fetch, sleep: async () => {} })).rejects.toThrow(/HTTP 404/);
    expect(f).toHaveBeenCalledTimes(1);
    try { await fetchWithRetry("https://x?apikey=SECRETKEY", { fetchImpl: f as unknown as typeof fetch, sleep: async () => {} }); } catch (e) { expect((e as Error).message).not.toContain("SECRETKEY"); }
  });
  it("Netzwerkfehler nach Ausschöpfen der Versuche → ProviderError NETZWERK", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchWithRetry("https://x", { fetchImpl: f as unknown as typeof fetch, sleep: async () => {}, retries: 2 })).rejects.toMatchObject({ kind: "NETZWERK" });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("Backoff wächst exponentiell und ist gedeckelt", () => {
    expect(backoffDelay(0, 1000, 30000, 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 30000, 1)).toBe(8000);
    expect(backoffDelay(10, 1000, 30000, 1)).toBe(30000);
  });
  it("RateLimiter: Mindestabstand und Tageskontingent", async () => {
    let now = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(1000, 2, async () => 0, async (ms) => { waits.push(ms); now += ms; }, () => now);
    await rl.acquire();
    await rl.acquire();
    expect(waits).toEqual([1000]);
    const full = new RateLimiter(0, 25, async () => 25);
    await expect(full.acquire()).rejects.toBeInstanceOf(ProviderError);
  });
});
