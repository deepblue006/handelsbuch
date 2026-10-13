/**
 * RSS-Import öffentlicher Posts aus einer zulässigen Quelle – kein Scraping von truthsocial.com
 * (Nutzungsbedingungen untersagen automatisierten Zugriff).
 * Quellen: eigene URL (TRUTHSOCIAL_FEED_URL, hat Vorrang) oder die vom Nutzer aktivierte Archiv-Voreinstellung.
 * Es erfolgt keine Filterung, Auswahl, Zusammenfassung oder Interpretation der Inhalte.
 */
export const OFFICIAL_PROFILE_URL = "https://truthsocial.com/@realDonaldTrump";

/**
 * Archiv „Trump's Truth“ (Defending Democracy Together, nicht mit Truth Social/Trump verbunden).
 * Laut FAQ (Websuche-Auszug, 13.10.2026): RSS unter /feed, Parameter limit (1–500, Standard 100) und
 * start_date/end_date; prüft alle paar Minuten auf neue Posts; Transkripte/Bildanalysen folgen später.
 * Feldstruktur des Feeds live nicht geprüft (Host in der Entwicklungsumgebung gesperrt).
 */
export const ARCHIVE_PRESET = {
  id: "trumpstruth",
  label: "Trump's Truth (trumpstruth.org)",
  operator: "Defending Democracy Together",
  feedUrl: "https://trumpstruth.org/feed?limit=50",
  website: "https://www.trumpstruth.org/",
  faqUrl: "https://www.trumpstruth.org/faq",
} as const;

export const MAX_FEED_BYTES = 5_000_000;

export type FeedSource = { kind: "ENV" | "PRESET"; url: string; label: string } | null;

/** Eigene URL (Umgebungsvariable) hat Vorrang vor der aktivierten Voreinstellung. */
export function resolveFeedSource(envUrl: string | undefined, presetActive: boolean): FeedSource {
  if (envUrl && /^https:\/\//i.test(envUrl)) return { kind: "ENV", url: envUrl, label: `eigene Quelle (${new URL(envUrl).host})` };
  if (presetActive) return { kind: "PRESET", url: ARCHIVE_PRESET.feedUrl, label: ARCHIVE_PRESET.label };
  return null;
}

const ORIGINAL_POST = /https:\/\/truthsocial\.com\/@realDonaldTrump\/(?:posts\/)?(\d{6,})/i;

/** Sucht im Eintrag nach dem Original-Link auf truthsocial.com (Link, GUID oder Text). */
export function findOriginalUrl(...candidates: string[]): string | null {
  for (const c of candidates) {
    const m = ORIGINAL_POST.exec(c);
    if (m) return `https://truthsocial.com/@realDonaldTrump/posts/${m[1]}`;
  }
  return null;
}

export interface FeedPost {
  id: string;
  createdAt: string; // ISO mit Zeitzone (UTC)
  text: string;
  url: string; // Original auf truthsocial.com, falls im Eintrag erkennbar, sonst Link der Quelle
  sourceUrl: string | null; // Link der Quelle, falls vom Original abweichend
  hasMedia: boolean;
  isRepost: boolean;
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
    const original = findOriginalUrl(link, guid, JSON.stringify(it));
    const text = htmlToText(raw);
    return [{
      id: original ?? (guid || link), createdAt: date.toISOString(), text, url: original ?? link, sourceUrl: original && original !== link ? link : null,
      hasMedia: !!it.enclosure || /<img|<video/i.test(raw), isRepost: false, // Repost-Kennzeichnung im Feed-Format nicht verifiziert
    }];
  }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
