"use client";
import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";

/** Formular mit Serveraktion und sichtbarer Rückmeldung (Erfolg/Fehler). */
export function ActionForm({ action, children, submit = "Speichern", className, resetKey }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  children: ReactNode;
  submit?: string;
  className?: string;
  resetKey?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className ?? "flex flex-col gap-3"} key={resetKey}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{pending ? "…" : submit}</button>
        {state && <span role="status" className={state.ok ? "text-xs text-good" : "text-xs text-bad"}>{state.ok ? "● " : "■ "}{state.message}</span>}
      </div>
    </form>
  );
}
