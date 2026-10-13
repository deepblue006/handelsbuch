import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText } from "@/lib/politics/pdf";
import { parsePtrText } from "@/lib/politics/normalize";

async function makePdf(lines: string[]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((l, i) => page.drawText(l, { x: 30, y: 740 - i * 18, size: 9, font }));
  return new Uint8Array(await doc.save());
}

describe("PTR-PDF-Textextraktion (synthetisches PDF – Layout echter Formulare nicht verifiziert)", () => {
  it("extrahiert Text und die Zeilen werden vom PTR-Parser erkannt", async () => {
    const pdf = await makePdf([
      "PERIODIC TRANSACTION REPORT",
      "SP NVIDIA Corporation - Common Stock (NVDA) [ST] P 08/18/2026 09/01/2026 $1,001 - $15,000",
      "Microsoft Corporation - Common Stock (MSFT) [ST] S 08/20/2026 09/02/2026 $15,001 - $50,000",
    ]);
    const r = await extractPdfText(pdf);
    expect(r.hasTextLayer).toBe(true);
    expect(r.pages).toBe(1);
    const tx = parsePtrText(r.text, { politicianName: "Test", chamber: "HOUSE", filedDate: "2026-09-10", state: null });
    expect(tx.map((t) => t.ticker)).toEqual(["NVDA", "MSFT"]);
    expect(tx[0]!.owner).toBe("SPOUSE");
    expect(tx[0]!.assetName).toBe("NVIDIA Corporation - Common Stock (NVDA) [ST]");
  });
  it("Kopfzeile ohne Eigentümerkürzel wird entfernt und markiert", async () => {
    const r = await extractPdfText(await makePdf(["PERIODIC TRANSACTION REPORT", "Apple Inc. - Common Stock (AAPL) [ST] P 08/18/2026 09/01/2026 $1,001 - $15,000"]));
    const tx = parsePtrText(r.text, { politicianName: "Test", chamber: "HOUSE", filedDate: "2026-09-10", state: null });
    expect(tx[0]!.assetName).toBe("Apple Inc. - Common Stock (AAPL) [ST]");
    expect(tx[0]!.uncertaintyFlags.join(" ")).toContain("Kopfzeilentext");
  });
  it("PDF ohne Textebene wird als OCR-Fall erkannt", async () => {
    const r = await extractPdfText(await makePdf([]));
    expect(r.hasTextLayer).toBe(false);
    expect(r.note).toContain("OCR");
  });
  it("lehnt Nicht-PDFs ab", async () => {
    await expect(extractPdfText(new TextEncoder().encode("<html>"))).rejects.toThrow(/kein PDF/);
  });
});
