/**
 * Optionaler RSS-Import für öffentliche Posts. Wird nur genutzt, wenn der Nutzer eine Quelle
 * konfiguriert, deren Nutzung er als zulässig geprüft hat (TRUTHSOCIAL_FEED_URL).
 * Es erfolgt keine Filterung, Auswahl, Zusammenfassung oder Interpretation der Inhalte.
 */
export const OFFICIAL_PROFILE_URL = "https://truthsocial.com/@realDonaldTrump";

export interface FeedPost {
  id: string;
  createdAt: string; // ISO mit Zeitzone (UTC)
  text: string;
  url: string;
  hasMedia: boolean;
}

/** Entfernt HTML-Tags, erhält Zeilenumbrüche; Text sonst unverändert. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .trim();
}

export async function parseRss(xml: string): Promise<FeedPost[]> {
  const { XMLParser } = await import("fast-xml-parser");
  const safe = xml.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?>/gi, ""); // keine DOCTYPE-Entitäten
  const p = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: false, isArray: (n) => n === "item" });
  const doc = p.parse(safe) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = doc.rss?.channel?.item ?? [];
  return items.flatMap((it) => {
    const link = String(it.link ?? "");
    const guid = typeof it.guid === "object" && it.guid ? String((it.guid as Record<string, unknown>)["#text"] ?? "") : String(it.guid ?? link);
    const date = new Date(String(it.pubDate ?? ""));
    if (!link || Number.isNaN(date.getTime())) return [];
    const raw = String(it.description ?? it.title ?? "");
    return [{ id: guid || link, createdAt: date.toISOString(), text: htmlToText(raw), url: link, hasMedia: !!it.enclosure || /<img|<video/i.test(raw) }];
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
