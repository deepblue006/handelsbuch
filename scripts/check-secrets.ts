/** Prüft, dass keine Secrets im Repository liegen (einfache Musterprüfung der versionierten Dateien). */
import { execSync } from "node:child_process";
import fs from "node:fs";

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter((f) => f && !f.startsWith("data/snapshots/") && !f.endsWith("package-lock.json"));
const patterns: [string, RegExp][] = [
  ["API-Key-Zuweisung", /(API_KEY|SECRET|PASSWORD)\s*=\s*["']?[A-Za-z0-9_\-]{12,}/],
  ["Private Key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Postgres-URL mit Passwort (außer Beispiel)", /postgres(?:ql)?:\/\/[^:\s]+:(?!handelsbuch_dev|change_me|PASSWORT)[^@\s]{6,}@/],
];
let bad = 0;
for (const f of files) {
  if (!fs.existsSync(f) || fs.statSync(f).size > 2_000_000) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const [name, re] of patterns) if (re.test(text) && !f.endsWith(".env.example")) { console.log(`VERDACHT ${name}: ${f}`); bad++; }
}
if (fs.existsSync(".env") && files.includes(".env")) { console.log("FEHLER: .env ist versioniert"); bad++; }
console.log(bad ? `${bad} Verdachtsfälle` : "Keine Secrets gefunden.");
process.exit(bad ? 1 : 0);
