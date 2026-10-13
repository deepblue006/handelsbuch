import { execSync } from "node:child_process";

/**
 * Bereitet die E2E-Testdatenbank vor: Migrationen (nicht destruktiv), Tabellen leeren,
 * echter Snapshot, Demodaten. Sicherheitsprüfung: Der Datenbankname MUSS auf "_test" enden.
 */
export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL fehlt (separate Testdatenbank, siehe docs/BETRIEB.md)");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) throw new Error(`Abbruch: E2E-Datenbank „${dbName}“ endet nicht auf _test – echte Daten werden nie geleert.`);
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx tsx scripts/reset-test-db.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/import-snapshot.ts", { env, stdio: "inherit" });
  execSync("npx tsx scripts/seed-demo.ts", { env, stdio: "inherit" });
}
