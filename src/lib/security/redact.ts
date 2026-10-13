/**
 * Entfernt Secrets aus Texten (Fehlermeldungen, Logs, URLs), bevor sie gespeichert oder angezeigt werden.
 */

const SECRET_PARAM = /((?:[?&]|\b)(?:apikey|api_key|api-key|key|token|access_token|x-cg-demo-api-key|x_cg_demo_api_key|secret|client_secret|password)\s*[=:]\s*)[^&#\s"',;]+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._\-~+/]+=*/g;
const CONN_STRING = /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+(@)/gi;
const PATH_KEY = /(pro-api\.llama\.fi\/)[^/\s]+/gi;
// Alpha Vantage nennt den Schlüssel im Klartext in Limit-Meldungen („detected your API key as XXXX“)
const KEY_IN_PROSE = /(\bapi[\s_-]?key\s+(?:as|is|was|=)\s+)[A-Za-z0-9_\-]{4,}/gi;

/** Liste der Umgebungsvariablen, deren Werte niemals ausgegeben werden dürfen. */
export const SECRET_ENV_KEYS = [
  "ALPHAVANTAGE_API_KEY",
  "FRED_API_KEY",
  "COINGECKO_API_KEY",
  "FMP_API_KEY",
  "SOSOVALUE_API_KEY",
  "DEFILLAMA_PRO_API_KEY",
  "CME_FEDWATCH_CLIENT_ID",
  "CME_FEDWATCH_CLIENT_SECRET",
  "EIA_API_KEY",
  "DATABASE_URL",
  "DASHBOARD_PASSWORD",
  "SESSION_SECRET",
];

export function redact(input: unknown, env: Record<string, string | undefined> = process.env): string {
  let s = typeof input === "string" ? input : input instanceof Error ? `${input.name}: ${input.message}` : safeStringify(input);
  s = s.replace(SECRET_PARAM, "$1***").replace(BEARER, "$1***").replace(CONN_STRING, "$1***$2").replace(PATH_KEY, "$1***").replace(KEY_IN_PROSE, "$1***");
  for (const k of SECRET_ENV_KEYS) {
    const v = env[k];
    if (v && v.length >= 6) s = s.split(v).join("***");
  }
  return s.length > 2000 ? s.slice(0, 2000) + " …(gekürzt)" : s;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Entfernt Konfigurations- und Secret-Felder aus Exportobjekten (rekursiv). */
export function stripSecretsForExport<T>(obj: T): T {
  const forbidden = /^(api[_-]?key|token|secret|password|databaseurl|database_url|privatekey|seed|mnemonic)$/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (forbidden.test(k.replace(/\s/g, ""))) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(obj) as T;
}

/** Erkennt Texte, die wie Seed-Phrasen oder private Schlüssel aussehen – solche Eingaben werden abgelehnt. */
export function looksLikeSecretMaterial(text: string): boolean {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  if (/\b(xprv|xpriv|tprv)[1-9A-HJ-NP-Za-km-z]{50,}/.test(text)) return true;
  if (/\b(0x)?[0-9a-fA-F]{64}\b/.test(text)) return true; // roher 256-bit Schlüssel
  const words = text.trim().toLowerCase().split(/\s+/);
  if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return true;
  return false;
}
