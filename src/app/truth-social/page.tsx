import { prisma } from "@/lib/db";
import { OFFICIAL_PROFILE_URL } from "@/lib/social/truthsocial";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { dateTimeDe } from "@/lib/format";
import { isEnabled } from "@/lib/server/refresh";

export const dynamic = "force-dynamic";

export default async function Truth() {
  const [posts, lastLog, enabled] = await Promise.all([
    prisma.socialPost.findMany({ where: { platform: "TRUTH_SOCIAL" }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.fetchLog.findFirst({ where: { providerId: "truthsocial" }, orderBy: { startedAt: "desc" } }),
    isEnabled("truthsocial"),
  ]);
  const configured = !!process.env.TRUTHSOCIAL_FEED_URL;
  const range = posts.length ? `${dateTimeDe(posts.at(-1)!.createdAt)} bis ${dateTimeDe(posts[0]!.createdAt)}` : null;
  return (
    <div>
      <PageHeader title="Truth Social – öffentliche Posts" subtitle="Separater Informationsbereich, getrennt von Kaufsignalen. Originaltext ohne Auswahl, Filterung, Zusammenfassung oder Interpretation." />
      <Card title="Feed auf der offiziellen Plattform">
        <p className="text-sm">Der Feed von @realDonaldTrump ist öffentlich direkt auf Truth Social einsehbar – vollständig, aktuell und im Original.</p>
        <p className="mt-3"><a href={OFFICIAL_PROFILE_URL} target="_blank" rel="noopener noreferrer" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">Offizielles Profil @realDonaldTrump öffnen</a></p>
        <p className="mt-2 text-[11px] text-ink-3">Öffnet truthsocial.com in einem neuen Tab. Das Dashboard bettet die Seite nicht ein und überträgt beim Öffnen keine Portfolio- oder Nutzungsdaten.</p>
      </Card>
      <Card title="Status der Datenübernahme ins Dashboard" className="mt-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={posts.length ? "info" : "warn"}>{posts.length ? `${posts.length} Posts gespeichert` : "Kein automatischer Abruf ins Dashboard"}</Badge>
          <Badge tone={enabled && configured ? "good" : "warn"}>{!configured ? "Keine zulässige Quelle konfiguriert" : enabled ? "Quelle aktiv" : "Quelle deaktiviert"}</Badge>
        </div>
        <ul className="mt-2 list-inside list-disc text-xs text-ink-2">
          <li>Für den automatischen Abruf wurde keine öffentliche, offiziell dokumentierte API gefunden. Berichten zufolge untersagen die Nutzungsbedingungen Scraping; der Betreiber kündigte an, Scraper zu blockieren. Daher kein Scraping und keine Umgehung von Zugangssperren.</li>
          <li>Optional: Eine selbst auf Zulässigkeit geprüfte RSS-Quelle kann über <code>TRUTHSOCIAL_FEED_URL</code> eingetragen und unter „Einstellungen“ aktiviert werden.</li>
          <li>Letzter Abruf: {lastLog ? `${dateTimeDe(lastLog.startedAt)} – ${lastLog.status}${lastLog.errorMessage ? ` (${lastLog.errorMessage})` : ""}` : "noch keiner"}. Abdeckung: {range ?? "keine"}.</li>
        </ul>
      </Card>
      <Card title="Posts (chronologisch, neueste zuerst)" className="mt-4">
        {posts.length ? (
          <ol className="space-y-3">
            {posts.map((p) => (
              <li key={p.id} className="border-b border-line pb-3">
                <div className="text-xs text-ink-3">{dateTimeDe(p.createdAt)} · <a className="text-accent" href={p.url} target="_blank" rel="noreferrer">Originalpost</a>{p.hasMedia && " · enthält Medien (nicht dargestellt)"} · Quelle {p.provider}</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{p.text}</p>
              </li>
            ))}
          </ol>
        ) : <Empty>Keine Posts im Dashboard gespeichert – es wird kein Live-Feed vorgetäuscht. Aktuelle Posts: siehe offizielles Profil oben.</Empty>}
      </Card>
    </div>
  );
}
