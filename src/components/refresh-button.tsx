"use client";
import { useActionState } from "react";
import { runRefresh, type ActionState } from "@/app/actions";

export function RefreshButton() {
  const [state, action, pending] = useActionState<ActionState>(runRefresh, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <button disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">{pending ? "Aktualisiere … (kann dauern)" : "Jetzt aktualisieren"}</button>
      {state && <span role="status" className={state.ok ? "text-xs text-good" : "text-xs text-bad"}>{state.message}</span>}
    </form>
  );
}
