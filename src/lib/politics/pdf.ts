/**
 * Textextraktion aus PTR-PDFs (elektronisch eingereichte Formulare haben eine Textebene).
 * Gescannte Meldungen ohne Textebene werden erkannt und als „OCR nötig“ markiert – es wird nichts geraten.
 * Das Ergebnis geht immer in die manuelle Prüfwarteschlange.
 */
export interface PdfTextResult {
  text: string;
  pages: number;
  hasTextLayer: boolean;
  note: string;
}

const MAX_BYTES = 20 * 1024 * 1024;

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  if (bytes.byteLength > MAX_BYTES) throw new Error("PDF zu groß (> 20 MB) – nicht verarbeitet");
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error("Datei ist kein PDF (Signatur %PDF fehlt)");
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(doc, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n") : text;
  const letters = (merged.match(/[A-Za-z]/g) ?? []).length;
  const hasTextLayer = letters >= 20;
  return {
    text: merged,
    pages: totalPages,
    hasTextLayer,
    note: hasTextLayer ? "Textebene vorhanden – automatisch extrahiert, Layout nicht gegen echte Formulare verifiziert" : "Keine verwertbare Textebene (vermutlich gescannt) – OCR bzw. manuelle Erfassung nötig",
  };
}
