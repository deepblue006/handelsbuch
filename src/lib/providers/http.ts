/**
 * HTTP-Zugriff für alle Provider: Timeout, Wiederholung mit exponentiellem Backoff bei
 * temporären Fehlern (Netzwerk, 429, 5xx), Beachtung von Retry-After, Ratenbegrenzung je Provider.
 * Fehlermeldungen werden vor Weitergabe von Secrets bereinigt.
 */
import { redact } from "../security/redact";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "NETZWERK" | "RATE_LIMIT" | "HTTP" | "FORMAT" | "ZUGANG_FEHLT" | "DEAKTIVIERT" | "PREMIUM",
    public readonly httpStatus?: number,
    public readonly retryable = false,
  ) {
    super(redact(message));
    this.name = "ProviderError";
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Für Tests injizierbar. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (attempt: number, delayMs: number, reason: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function backoffDelay(attempt: number, base: number, max: number, jitter = Math.random()): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp / 2 + (exp / 2) * jitter);
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  let lastErr: ProviderError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    try {
      const res = await f(url, { headers: opts.headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new ProviderError(`HTTP ${res.status} bei ${url}`, res.status === 429 ? "RATE_LIMIT" : "HTTP", res.status, retryable);
      if (!retryable || attempt === retries) throw lastErr;
      const ra = parseRetryAfter(res.headers.get("retry-after"));
      const delay = Math.min(max, ra ?? backoffDelay(attempt, base, max));
      opts.onAttempt?.(attempt + 1, delay, `HTTP ${res.status}`);
      await sleep(delay);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ProviderError) {
        if (!e.retryable || attempt === retries) throw e;
        continue;
      }
      lastErr = new ProviderError(`Netzwerkfehler bei ${url}: ${(e as Error).message}`, "NETZWERK", undefined, true);
      if (attempt === retries) throw lastErr;
      const delay = backoffDelay(attempt, base, max);
      opts.onAttempt?.(attempt + 1, delay, "Netzwerk");
      await sleep(delay);
    }
  }
  throw lastErr ?? new ProviderError(`Unbekannter Fehler bei ${url}`, "NETZWERK");
}

/**
 * Einfache Ratenbegrenzung: Mindestabstand zwischen Aufrufen und Tageskontingent.
 * Das Tageskontingent wird über `countToday` (z. B. aus FetchLog) geprüft, damit es Neustarts übersteht.
 */
export class RateLimiter {
  private last = Number.NEGATIVE_INFINITY;
  private chain: Promise<void> = Promise.resolve();
  constructor(
    private readonly minIntervalMs: number,
    private readonly dailyLimit: number | null = null,
    private readonly countToday: () => Promise<number> = async () => 0,
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = Date.now,
  ) {}

  async acquire(): Promise<void> {
    const run = async () => {
      if (this.dailyLimit != null) {
        const used = await this.countToday();
        if (used >= this.dailyLimit) throw new ProviderError(`Tageskontingent erschöpft (${used}/${this.dailyLimit})`, "RATE_LIMIT", 429, false);
      }
      const wait = this.last + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.last = this.now();
    };
    const p = this.chain.then(run);
    this.chain = p.catch(() => undefined);
    return p;
  }
}
