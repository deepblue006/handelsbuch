import { describe, expect, it } from "vitest";
import { parseCongressTrades } from "@/lib/providers/alphavantage";
import { fromAlphaVantage, checkPlausibility, statusFor, reconcile, orderForIngest, applyActions, dedupeKey, correctionKey, parsePtrText, parseHouseIndexXml, usDateToIso, mapOwner, type NormTx, type StoredTx } from "@/lib/politics/normalize";
import { loadSnapshot } from "./helpers";

const real = parseCongressTrades(loadSnapshot("CONGRESS_TRADES_NVDA.json")).trades.map(fromAlphaVantage);

function ingest(rows: NormTx[]) {
  let id = 0;
  let store: StoredTx[] = [];
  const all: ReturnType<typeof reconcile> = [];
  for (const t of orderForIngest(rows)) {
    const acts = reconcile(store, [t]);
    store = applyActions(store, acts, () => `id${++id}`);
    all.push(...acts);
  }
  return { store, actions: all };
}

describe("Normalisierung echter Kongressmeldungen (Sekundärquelle Alpha Vantage)", () => {
  it("Transaktions-, Benachrichtigungs- und Einreichungsdatum bleiben getrennt; kein Veröffentlichungsdatum erfunden", () => {
    const t = real.find((x) => x.politicianName === "Gilbert Ray Cisneros, Jr." && x.transactionDate === "2026-08-18")!;
    expect(t.transactionDate).toBe("2026-08-18");
    expect(t.notificationDate).toBe("2026-09-04");
    expect(t.filedDate).toBe("2026-09-10");
    expect(t.publishedDate).toBeNull();
  });
  it("Beträge bleiben Spannen", () => {
    const t = real[0]!;
    expect(t.amountMin).toBe(1001);
    expect(t.amountMax).toBe(15000);
    expect(t.amountText).toContain("Spanne");
  });
  it("Eigentümer genau wie gemeldet; Optionen von Aktien unterschieden", () => {
    expect(new Set(real.map((t) => t.owner))).toEqual(new Set(["SELF", "SPOUSE", "DEPENDENT_CHILD", "JOINT"]));
    expect(real.filter((t) => t.instrumentKind === "OPTION").length).toBe(11); // 7× OP + 4× Stock Option
    expect(real.filter((t) => t.instrumentKind === "AKTIE").length).toBe(425);
  });
  it("uneinheitliche Codes und abgeleitete Ticker werden als Unsicherheit markiert", () => {
    expect(real.filter((t) => t.uncertaintyFlags.some((f) => f.includes("„sT“"))).length).toBe(1);
    expect(real.filter((t) => t.uncertaintyFlags.some((f) => f.includes("abgeleitet"))).length).toBe(25);
  });
  it("Sekundärquelle wird nie als offiziell geprüft eingestuft", () => {
    const t = real[0]!;
    expect(statusFor(t, checkPlausibility(t, "2026-10-11")).status).toBe("SEKUNDAERQUELLE");
  });
});

describe("Korrekturen und Deduplizierung (echte Suozzi-Korrekturen vom 19.12.2022)", () => {
  const { store, actions } = ingest(real);
  it("AMENDED ersetzt die ursprüngliche OTHER-Meldung, auch wenn Typ und Betrag abweichen", () => {
    const sup = actions.filter((a) => a.kind === "SUPERSEDE");
    expect(sup.length).toBe(4);
    const jul = sup.find((a) => a.incoming.transactionDate === "2019-07-29")!;
    expect(jul.incoming.txType).toBe("KAUF");
    expect(jul.incoming.amountMax).toBe(15000);
    expect(jul.version).toBe(2);
  });
  it("DELETED wird über die Betragsspanne eindeutig zugeordnet", () => {
    const del = actions.filter((a) => a.kind === "DELETE_MARK");
    expect(del.length).toBe(1);
    const target = store.find((s) => s.id === del[0]!.targets[0])!;
    expect(target.amountMin).toBe(100001);
    expect(target.isCurrent).toBe(false);
  });
  it("erneute Lieferung derselben Daten erzeugt keine Dubletten", () => {
    const before = store.length;
    const again = reconcile(store, orderForIngest(real).filter((t) => (t.sourceFilingStatus ?? "NEW") !== "AMENDED" && t.sourceFilingStatus !== "DELETED"));
    expect(again.every((a) => a.kind === "DUPLICATE")).toBe(true);
    expect(applyActions(store, again, () => "x").length).toBe(before);
  });
  it("mehrdeutige Korrektur → manuelle Prüfung", () => {
    const base = real.find((t) => t.politicianName === "Gilbert Ray Cisneros, Jr.")!;
    const a = { ...base, amountMin: 1001, amountMax: 15000, txType: "SONSTIGE" as const, filedDate: "2026-01-01", sourceFilingStatus: "NEW" };
    const b = { ...a, amountMin: 15001, amountMax: 50000 };
    const st: StoredTx[] = [a, b].map((x, i) => ({ id: `s${i}`, dedupeKey: dedupeKey(x), correctionKey: correctionKey(x), txType: x.txType, amountMin: x.amountMin, amountMax: x.amountMax, version: 1, isCurrent: true, filedDate: x.filedDate }));
    const r = reconcile(st, [{ ...a, txType: "VERKAUF", amountMin: 50001, amountMax: 100000, filedDate: "2026-02-01", sourceFilingStatus: "AMENDED" }]);
    expect(r[0]!.kind).toBe("REVIEW");
  });
});

describe("Plausibilitätsprüfung", () => {
  const base = real[0]!;
  it("verspätete Einreichung als Hinweis ohne Wertung", () => {
    const p = checkPlausibility({ ...base, transactionDate: "2026-01-01", filedDate: "2026-03-15" }, "2026-10-11");
    expect(p.ok).toBe(true);
    expect(p.warnings.join(" ")).toContain("keine Wertung");
  });
  it("harte Fehler: Einreichung vor Transaktion, Zukunftsdatum, fehlende Spanne", () => {
    expect(checkPlausibility({ ...base, transactionDate: "2026-05-01", filedDate: "2026-04-01" }, "2026-10-11").hardErrors).toContain("Einreichung vor Transaktion");
    expect(checkPlausibility({ ...base, transactionDate: "2027-01-01", filedDate: null }, "2026-10-11").ok).toBe(false);
    expect(checkPlausibility({ ...base, amountMin: null, amountMax: null }, "2026-10-11").hardErrors).toContain("Betragsspanne fehlt");
  });
  it("Spanne außerhalb der offiziellen Formularspannen", () => {
    expect(checkPlausibility({ ...base, amountMin: 1000, amountMax: 2000 }, "2026-10-11").warnings.join(" ")).toContain("offiziellen Formularspanne");
  });
});

describe("House Clerk – Index und PTR-Text (synthetische Beispiele nach Formularaufbau, nicht gegen echte Dokumente verifiziert)", () => {
  it("Index-XML: Meldetyp, Datum, PDF-Link", async () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><FinancialDisclosure><Member><Prefix>Hon.</Prefix><Last>Muster</Last><First>Max</First><Suffix/><FilingType>P</FilingType><StateDst>CA31</StateDst><Year>2026</Year><FilingDate>9/10/2026</FilingDate><DocID>20031234</DocID></Member><Member><Prefix/><Last>Beispiel</Last><First>Erika</First><Suffix/><FilingType>O</FilingType><StateDst>NY03</StateDst><Year>2026</Year><FilingDate>5/15/2026</FilingDate><DocID>10070001</DocID></Member></FinancialDisclosure>`;
    const r = await parseHouseIndexXml(xml);
    expect(r[0]).toMatchObject({ docId: "20031234", filerName: "Hon. Max Muster", filingType: "PTR", filedDate: "2026-09-10", pdfUrl: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20031234.pdf" });
    expect(r[1]!.filingType).toBe("ANNUAL");
  });
  it("XML-Entitäten werden nicht expandiert (Schutz vor Entity-Expansion)", async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "AAAAAAAAAA">]><FinancialDisclosure><Member><Last>&a;</Last><FilingType>P</FilingType><Year>2026</Year><DocID>1</DocID></Member></FinancialDisclosure>`;
    const r = await parseHouseIndexXml(xml);
    expect(r[0]!.filerName).not.toContain("AAAAAAAAAA");
  });
  it("PTR-Text: Eigentümer, Ticker, Typ, Daten, Spanne, Konfidenz", () => {
    const text = `SP NVIDIA Corporation - Common Stock (NVDA) [ST] P 08/18/2026 09/01/2026 $1,001 - $15,000\nMicrosoft Corporation - Common Stock (MSFT) [OP] S (partial) 08/20/2026 09/02/2026 $15,001 - $50,000\nJT Ein Fonds ohne Kürzel P 08/21/2026 09/03/2026 Over $50,000,000`;
    const r = parsePtrText(text, { politicianName: "Max Muster", chamber: "HOUSE", filedDate: "2026-09-10", state: "CA31" });
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ owner: "SPOUSE", ticker: "NVDA", txType: "KAUF", instrumentKind: "AKTIE", transactionDate: "2026-08-18", notificationDate: "2026-09-01", filedDate: "2026-09-10", amountMin: 1001, amountMax: 15000 });
    expect(r[1]).toMatchObject({ owner: "SELF", txType: "TEILVERKAUF", instrumentKind: "OPTION" });
    expect(r[1]!.uncertaintyFlags.join(" ")).toContain("Eigentümerkürzel");
    expect(r[2]).toMatchObject({ owner: "JOINT", ticker: null, amountMin: 50000001, amountMax: null });
    expect(r[2]!.extractionConfidence!).toBeLessThan(0.8);
    expect(statusFor(r[2]!, checkPlausibility(r[2]!, "2026-10-11")).status).toBe("NICHT_EINDEUTIG");
    expect(statusFor(r[0]!, checkPlausibility(r[0]!, "2026-10-11")).needsReview).toBe(true); // Extraktion immer prüfen
  });
  it("Hilfsfunktionen", () => {
    expect(usDateToIso("9/1/2026")).toBe("2026-09-01");
    expect(usDateToIso("2026-09-01")).toBeNull();
    expect(mapOwner(null)).toBe("UNBEKANNT");
    expect(mapOwner("SP")).toBe("SPOUSE");
  });
});
