import { prisma } from "@/lib/db";
import { OFFICIAL_PROFILE_URL, ARCHIVE_PRESET } from "@/lib/social/truthsocial";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { ActionForm } from "@/components/forms";
import { dateTimeDe } from "@/lib/format";
import { isEnabled, truthFeedSource } from "@/lib/server/refresh";
import { setTruthPreset, fetchTruthNow } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Truth() {
  const [posts, lastLog, enabled, source, preset] = await Promise.all([
    prisma.socialPost.findMany({ where: { platform: "TRUTH_SOCIAL" }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.fetchLog.findFirst({ where: { providerId: "truthsocial" }, orderBy: { startedAt: "desc" } }),
    isEnabled("truthsocial"),
    truthFeedSource(),
    prisma.setting.findUnique({ where: { key: "truthFeedPreset" } }),
  ]);
  const presetActive = !!(preset?.value as { active?: boolean } | null)?.active;
  const envActive = source?.kind === "ENV";
  const range = posts.length ? `${dateTimeDe(posts.at(-1)!.createdAt)} bis ${dateTimeDe(posts[0]!.createdAt)}` : null;
  return (
    <div>
      <PageHeader title="Truth Social – öffentliche Posts" subtitle="Separater Informationsbereich, getrennt von Kaufsignalen. Text ohne Auswahl, Filterung, Zusammenfassung oder Interpretation." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Feed auf der offiziellen Plattform">
          <p className="text-sm">Der Feed von @realDonaldTrump ist öffentlich direkt auf Truth Social einsehbar – vollständig, aktuell und im Original.</p>
          <p className="mt-3"><a href={OFFICIAL_PROFILE_URL} target="_blank" rel="noopener noreferrer" className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">Offizielles Profil @realDonaldTrump öffnen</a></p>
          <p className="mt-2 text-[11px] text-ink-3">Öffnet truthsocial.com in einem neuen Tab. Das Dashboard bettet die Seite nicht ein und überträgt keine Portfolio- oder Nutzungsdaten.</p>
        </Card>

        <Card title="Posts im Dashboard – Quelle" id="quelle">
          <div className="flex flex-wrap gap-2">
            <Badge tone={source && enabled ? "good" : "warn"}>{source ? (enabled ? `Aktiv: ${source.label}` : `${source.label} – Provider deaktiviert`) : "Keine Quelle aktiv – kein automatischer Abruf ins Dashboard"}</Badge>
            {posts.length > 0 && <Badge tone="info">{posts.length} Posts gespeichert</Badge>}
          </div>
          <ul className="mt-2 list-inside list-disc text-xs text-ink-2">
            <li>Direkter Abruf von truthsocial.com scheidet aus: keine öffentliche API, die Nutzungsbedingungen untersagen automatisierten Zugriff. Offiziell gibt es nur eine kostenpflichtige Daten-API von Trump Media für Unternehmen.</li>
            <li>Möglich ist ein öffentlicher RSS-Feed eines unabhängigen Archivs: <b>{ARCHIVE_PRESET.label}</b>, betrieben von {ARCHIVE_PRESET.operator} (laut Archiv nicht mit Truth Social oder Donald Trump verbunden). Das Archiv prüft laut eigener FAQ alle paar Minuten auf neue Posts; Verzögerungen und Lücken sind möglich, gelöschte Posts können dort weiter erscheinen.</li>
            <li>Das Dashboard übernimmt den Text so, wie die Quelle ihn liefert (beim ersten Abruf, danach unverändert), und verlinkt – wenn im Eintrag enthalten – den Originalpost auf Truth Social. Feldstruktur des Archiv-Feeds in der Entwicklungsumgebung nicht live geprüft.</li>
            <li>Letzter Abruf: {lastLog ? `${dateTimeDe(lastLog.startedAt)} – ${lastLog.status}${lastLog.errorMessage ? ` (${lastLog.errorMessage})` : ""}` : "noch keiner"}. Abdeckung: {range ?? "keine"}. Der Scheduler ruft den Feed alle 15 Minuten ab (TRUTHSOCIAL_REFRESH_MINUTES).</li>
          </ul>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            {envActive ? (
              <p className="text-xs text-ink-3">Eigene Quelle über TRUTHSOCIAL_FEED_URL gesetzt – hat Vorrang vor der Archiv-Voreinstellung.</p>
            ) : presetActive ? (
              <ActionForm action={setTruthPreset} submit="Archivquelle deaktivieren" className="text-xs"><input type="hidden" name="active" value="0" /></ActionForm>
            ) : (
              <ActionForm action={setTruthPreset} submit="Archivquelle aktivieren und abrufen" className="text-xs"><input type="hidden" name="active" value="1" /></ActionForm>
            )}
            {source && enabled && <ActionForm action={fetchTruthNow} submit="Jetzt abrufen" className="text-xs"><span /></ActionForm>}
          </div>
          <p className="mt-2 text-[11px] text-ink-3"><a className="text-accent" href={ARCHIVE_PRESET.faqUrl} target="_blank" rel="noopener noreferrer">FAQ des Archivs</a> · Abruf erfolgt vom Dashboard-Server; dabei werden keine persönlichen Daten übertragen.</p>
        </Card>
      </div>

      <Card title="Posts (chronologisch, neueste zuerst)" className="mt-4">
        {posts.length ? (
          <ol className="space-y-3">
            {posts.map((p) => {
              const original = p.url.startsWith("https://truthsocial.com/");
              return (
                <li key={p.id} className="border-b border-line pb-3">
                  <div className="text-xs text-ink-3">
                    {dateTimeDe(p.createdAt)} ·{" "}
                    {original ? <a className="text-accent" href={p.url} target="_blank" rel="noopener noreferrer">Original auf Truth Social</a> : <a className="text-accent" href={p.url} target="_blank" rel="noopener noreferrer">Eintrag in der Quelle</a>}
                    {p.sourceUrl && <> · <a className="text-accent" href={p.sourceUrl} target="_blank" rel="noopener noreferrer">Archiv-Eintrag</a></>}
                    {p.hasMedia && " · enthält Medien (nicht dargestellt)"} · Quelle: {p.provider} · abgerufen {dateTimeDe(p.fetchedAt)}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{p.text || <span className="text-ink-3">(kein Text – z. B. reiner Medien-Post)</span>}</p>
                </li>
              );
            })}
          </ol>
        ) : <Empty>Keine Posts im Dashboard gespeichert – es wird kein Live-Feed vorgetäuscht. Aktuelle Posts: siehe offizielles Profil oben oder Archivquelle aktivieren.</Empty>}
      </Card>
    </div>
  );
}
