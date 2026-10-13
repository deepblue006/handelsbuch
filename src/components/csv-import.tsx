"use client";
import { useActionState, useState } from "react";
import { previewCsv, importLegacy, type ActionState } from "@/app/actions";
import { CSV_TEMPLATE_HEADER } from "@/lib/portfolio/import";

/** CSV-Import mit Vorschau: erst prüfen, dann ausdrücklich bestätigen. */
export function CsvImport() {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(previewCsv, null);
  const p = state?.preview;
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-2">Spalten (Semikolon oder Komma): <code className="break-all">{CSV_TEMPLATE_HEADER}</code>. Zahlen in deutscher oder englischer Schreibweise; <code>wechselkurs_zur_basis</code> = Basiswährung je 1 Einheit Handelswährung am Handelstag.</p>
      <input type="file" accept=".csv,text/csv" aria-label="CSV-Datei wählen" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { if (f.size > 1_000_000) { alert("Datei zu groß (max. 1 MB)"); return; } setName(f.name); setText(await f.text()); } }} />
      <textarea aria-label="CSV-Inhalt" rows={5} className="w-full font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={CSV_TEMPLATE_HEADER} />
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="csv" value={text} />
        <input type="hidden" name="filename" value={name} />
        <button disabled={pending || !text} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50">Vorschau prüfen</button>
        {p && p.valid.length > 0 && <button name="commit" value="1" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">{p.valid.length} gültige Zeilen importieren</button>}
      </form>
      {state && <p role="status" className={state.ok ? "text-xs text-good" : "text-xs text-bad"}>{state.message}</p>}
      {p && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-semibold">Gültig ({p.valid.length})</h3>
            <ul className="max-h-60 overflow-auto text-xs">{p.valid.map((v) => <li key={v.line} className="border-b border-line py-1">Z. {v.line}: {v.row.tradeDate} {v.row.side} {v.row.quantity} × {v.row.symbol} @ {v.row.price} {v.row.currency}{v.warnings.length ? <span className="block text-warn">▲ {v.warnings.join("; ")}</span> : null}</li>)}</ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold">Ungültig ({p.invalid.length}) – werden nicht importiert</h3>
            <ul className="max-h-60 overflow-auto text-xs">{p.invalid.map((v, i) => <li key={i} className="border-b border-line py-1 text-bad">Z. {v.line}: {v.errors.join("; ")}</li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}

export function LegacyImport() {
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(importLegacy, null);
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-2">Sicherungsdatei des bisherigen Handelsbuchs (<code>handelsbuch-JJJJ-MM-TT.json</code>). Alle Beträge werden wie dort in EUR übernommen; Kurse daraus gelten als manuelle Eingaben.</p>
      <input type="file" accept=".json,application/json" aria-label="Sicherungsdatei wählen" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <form action={action}><input type="hidden" name="json" value={text} /><button disabled={pending || !text} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50">Sicherung übernehmen</button></form>
      {state && <p role="status" className={state.ok ? "text-xs text-good" : "text-xs text-bad"}>{state.message}</p>}
    </div>
  );
}
