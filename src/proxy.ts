import { NextResponse, type NextRequest } from "next/server";

/**
 * Optionaler Zugriffsschutz (HTTP Basic Auth). Aktiv, sobald DASHBOARD_PASSWORD gesetzt ist.
 * Für den Betrieb außerhalb von localhost unbedingt setzen und nur über HTTPS bereitstellen.
 */
export function proxy(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return NextResponse.next();
  const user = process.env.DASHBOARD_USER ?? "depot";
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, p] = atob(header.slice(6)).split(":");
    if (u === user && p === pw) return NextResponse.next();
  }
  return new NextResponse("Anmeldung erforderlich", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Handelsbuch", charset="UTF-8"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
