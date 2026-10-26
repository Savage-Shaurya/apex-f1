import { createHash } from 'node:crypto';
import { requestJson, untrackedFetch } from '../transport';
import { jolpicaRedisConfig, jolpicaRedisPrefix, type JolpicaRedisConfig } from './shared-admission';

/**
 * Last-good copies of validated Jolpica responses, shared by every server
 * instance through Upstash (audit F-02).
 *
 * The process cache already serves a validated copy while Jolpica is failing
 * or rate-limited, but a new serverless instance starts empty: one 429 made
 * every uncached Jolpica page answer HTTP 500 until the cooldown ended. While
 * a read is refused (cooldown, 429, outage) the request controller now asks
 * this store for the last copy any instance validated, inside the same stale
 * window as the process cache (6 h for live data; completed seasons never
 * change, so their copies stay usable for the whole TTL).
 *
 * Values are the provider's own validated JSON, never edited. Keys are
 * environment-scoped (F-07). Every call is bounded and a failure reads as a miss.
 */
export interface JolpicaLastGoodEntry { storedAt: number; value: unknown }
export interface JolpicaLastGoodStore {
  read(key: string): Promise<JolpicaLastGoodEntry | null>;
  write(key: string, entry: JolpicaLastGoodEntry): Promise<void>;
}

export const JOLPICA_LAST_GOOD_MAX_BYTES = 900_000;
export const JOLPICA_LAST_GOOD_TTL_S = 30 * 86_400;
/** One instance rewrites the same key at most this often (bounds Redis commands). */
export const JOLPICA_LAST_GOOD_WRITE_INTERVAL_MS = 10 * 60_000;

function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function validEntry(value: unknown): value is JolpicaLastGoodEntry & { key: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.key === 'string' && typeof entry.storedAt === 'number' && Number.isSafeInteger(entry.storedAt) && entry.storedAt > 0 && 'value' in entry;
}

export function createRedisJolpicaLastGoodStore(
  config: JolpicaRedisConfig,
  options: { fetch?: typeof fetch; env?: Readonly<Record<string, string | undefined>>; timeoutMs?: number } = {},
): JolpicaLastGoodStore {
  const prefix = `${jolpicaRedisPrefix(options.env)}:last-good:`;
  const call = (command: string[]) => requestJson<{ result?: unknown }>('jolpica', config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  // Untracked: a no-store control request must not make an ISR render dynamic.
  }, { fetchImpl: options.fetch ?? untrackedFetch(), timeoutMs: options.timeoutMs ?? 1_500, maxBytes: JOLPICA_LAST_GOOD_MAX_BYTES + 4096 });
  const lastWrite = new Map<string, number>();
  return {
    async read(key) {
      try {
        const reply = await call(['GET', `${prefix}${digest(key)}`]);
        if (typeof reply?.result !== 'string') return null;
        const entry = JSON.parse(reply.result) as unknown;
        return validEntry(entry) && entry.key === key ? { storedAt: entry.storedAt, value: entry.value } : null;
      } catch { return null; }
    },
    async write(key, entry) {
      const previous = lastWrite.get(key);
      if (previous !== undefined && entry.storedAt - previous < JOLPICA_LAST_GOOD_WRITE_INTERVAL_MS) return;
      const text = JSON.stringify({ key, storedAt: entry.storedAt, value: entry.value });
      if (new TextEncoder().encode(text).byteLength > JOLPICA_LAST_GOOD_MAX_BYTES) return;
      lastWrite.set(key, entry.storedAt);
      if (lastWrite.size > 2048) lastWrite.delete(lastWrite.keys().next().value!);
      try { await call(['SET', `${prefix}${digest(key)}`, text, 'EX', String(JOLPICA_LAST_GOOD_TTL_S)]); }
      catch { lastWrite.delete(key); }
    },
  };
}

/** The Redis store when Upstash is configured, else none (the process cache still applies). */
export function defaultJolpicaLastGoodStore(env: Readonly<Record<string, string | undefined>> = process.env): JolpicaLastGoodStore | null {
  const config = jolpicaRedisConfig(env);
  return config ? createRedisJolpicaLastGoodStore(config, { env }) : null;
}

/**
 * A completed season's data never changes, so its last-good copy may be used
 * for the whole TTL; everything else (current season, `current`, career
 * lists that grow) only inside the normal stale-if-error window.
 */
export function jolpicaKeyIsImmutable(key: string, now = Date.now()): boolean {
  let path: string;
  try { path = new URL(key).pathname; } catch { return false; }
  const year = new Date(now).getUTCFullYear();
  const season = path.match(/\/((?:19|20)\d{2})(?:\/|\.json)/);
  return Boolean(season && Number(season[1]) < year);
}
