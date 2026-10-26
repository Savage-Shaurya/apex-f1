/**
 * Structured server logging: one JSON object per line so Vercel's log search
 * can filter on `event`, `level`, `route` or `provider`. Values pass through
 * `redact` first, so a provider error that echoes a URL with an API key, a
 * bearer token or a database connection string never reaches the log.
 *
 * Runtime-neutral (no Node imports): safe in route handlers, the proxy and
 * instrumentation on either runtime.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SECRET_KEY = /(secret|token|password|passwd|authorization|cookie|api[-_]?key|apikey|credential|private|session)/i;
const MAX_STRING = 2_000;

/** Removes credentials from free text: URL userinfo, secret query params, bearer/basic tokens, key-shaped values. */
export function redact(text: string): string {
  return text
    // scheme://user:password@host  ->  scheme://[redacted]@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
    // ?apiKey=...&token=...  (any secret-looking parameter name)
    .replace(/([?&;\s]|^)((?:[a-z0-9_-]*)(?:key|token|secret|password|signature|sig|auth)[a-z0-9_-]*)=([^&\s"';]+)/gi, '$1$2=[redacted]')
    // ?code=... (OAuth authorization codes) only as a URL parameter: a bare
    // "code=ECONNREFUSED" in an error summary is a diagnostic, not a secret.
    .replace(/([?&])(code)=([^&\s"';]+)/gi, '$1$2=[redacted]')
    // Authorization: Bearer xyz / Basic xyz
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/g, '$1 [redacted]')
    // Well-known key shapes (Resend, Groq, GitHub, Hugging Face, Google, Slack)
    .replace(/\b(re_|gsk_|ghp_|gho_|github_pat_|hf_|AIza|xox[abp]-)[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

function clean(value: unknown, key: string, depth: number): unknown {
  if (SECRET_KEY.test(key)) return value === undefined || value === null || value === '' ? value : '[redacted]';
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redact(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
  if (value instanceof Error) return { name: value.name, message: redact(value.message.slice(0, MAX_STRING)) };
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => clean(item, '', depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[k] = clean(v, k, depth + 1);
    return out;
  }
  return redact(String(value));
}

/** Emits `{"ts","level","event",...fields}` on the console method matching the level. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const record: Record<string, unknown> = { ts: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'ts' || key === 'level' || key === 'event') continue;
    record[key] = clean(value, key, 0);
  }
  let line: string;
  try { line = JSON.stringify(record); } catch { line = JSON.stringify({ ts: record.ts, level, event, note: 'unserializable fields dropped' }); }
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Safe summary of an unknown thrown value: its class name and a redacted, bounded message. */
export function errorSummary(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: redact(error.message.slice(0, 500)) };
  return { name: typeof error, message: redact(String(error).slice(0, 500)) };
}
