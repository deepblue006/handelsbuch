import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { displayFx } from "@/lib/server/data";
import { dateDe, num, type DisplayFx } from "@/lib/format";

export const metadata: Metadata = {
  title: "Handelsbuch – Investment-Dashboard",
  description: "Persönliches Analyse- und Entscheidungshilfe-Dashboard für Aktien, ETFs und Krypto. Keine automatische Orderausführung.",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/", label: "Übersicht" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/cockpit", label: "Kauf-Cockpit" },
  { href: "/markt", label: "Marktlage & Finanzwiesel-Kennzahlen" },
  { href: "/flows", label: "ETF- & ETP-Flows" },
  { href: "/politiker", label: "US-Politiker-Transaktionsradar" },
  { href: "/truth-social", label: "Truth Social – öffentliche Posts" },
  { href: "/kaufplan", label: "Kaufplan & Cash" },
  { href: "/risiko", label: "Risiko & Thesen" },
  { href: "/einstellungen", label: "Datenquellen & Einstellungen" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let fx: DisplayFx | null = null;
  try { fx = await displayFx(); } catch { fx = null; } // Datenbankfehler darf die Navigation nicht blockieren
  return (
    <html lang="de">
      <body className="min-h-screen font-sans text-sm">
        <div className="mx-auto flex max-w-[1500px] flex-col md:flex-row">
          <nav aria-label="Hauptnavigation" className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
            <div className="px-4 py-4">
              <Link href="/" className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-2">Handelsbuch</Link>
              <p className="mt-1 text-[11px] text-ink-3">Analyse, keine Orderausführung</p>
            </div>
            <ul className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink md:whitespace-normal">{n.label}</Link>
                </li>
              ))}
            </ul>
            <p className="hidden px-4 pb-4 pt-2 text-[11px] leading-snug text-ink-3 md:block" data-testid="fx-note">
              Dollarwerte: {fx?.usdPerEur ? <>1 € = {num(fx.usdPerEur, 4)} $<br />({fx.source ?? "–"}, Stand {dateDe(fx.date)})</> : "kein EUR/USD-Kurs vorhanden – Dollarwerte fehlen"}
              <br />Zeiten: Berlin · New York (ET)
            </p>
          </nav>
          <main className="min-w-0 flex-1 px-4 py-5 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
