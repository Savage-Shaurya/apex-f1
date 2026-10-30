import { createHash } from 'node:crypto';
import { requestJson, untrackedFetch } from '../transport';
import { scopedRedisKey } from '../redis-scope';
import { guardedRedisFetch } from '../redis-guard';
import { isBuildPhase } from '../build-phase';

/**
 * Last-good snapshots of OpenF1 responses.
 *
 * OpenF1's free API refuses every request, historical ones included, while a
 * Formula 1 session is live ("Live F1 session in progress ... restricted to
 * authenticated users"). Every successful, validated OpenF1 response is kept
 * here with the time it was fetched, so a race-weekend page can still show the
 * real data it last saw, labelled honestly with that "as of" time.
 *
 * Storage: process memory always; Upstash Redis as well when it is configured
 * (shared by every server instance, kept 30 days). Rows are the provider's own
 * validated JSON, never edited or synthesised.
 */
export interface OpenF1LastGoodEntry {
  version: 1;
  key: string;
  /** When the provider returned these rows (ms since epoch). */
  storedAt: number;
  rows: unknown[];
}

export interface OpenF1LastGoodStore {
  read(key: string): Promise<OpenF1LastGoodEntry | null>;
  write(entry: OpenF1LastGoodEntry): Promise<void>;
}

/** Largest snapshot persisted (Upstash REST request bodies stay well under 1 MB). */
export const OPENF1_LAST_GOOD_MAX_BYTES = 900_000;
export const OPENF1_LAST_GOOD_TTL_S = 30 * 86_400;
const REDIS_PREFIX = 'apex:openf1:v1:last-good:';

/** Stable identity of one OpenF1 query: path, sorted params and date filters. Never includes a token. */
export function openF1LastGoodKey(path: string, params: Record<string, string | number>, dateGte?: string, dateLte?: string): string {
  const sorted = Object.entries(params).map(([key, value]) => [key, String(value)]).sort(([a], [b]) => a!.localeCompare(b!));
  return createHash('sha256').update(JSON.stringify(['openf1-last-good', 1, path, sorted, dateGte ?? null, dateLte ?? null])).digest('hex');
}

function validEntry(value: unknown, key: string): value is OpenF1LastGoodEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return entry.version === 1 && entry.key === key && typeof entry.storedAt === 'number' && Number.isSafeInteger(entry.storedAt)
    && entry.storedAt > 0 && Array.isArray(entry.rows);
}

/** Bounded in-process store (LRU by insertion order). */
export function createMemoryLastGoodStore(options: { maxEntries?: number; maxBytes?: number } = {}): OpenF1LastGoodStore {
  const maxEntries = options.maxEntries ?? 256;
  const maxBytes = options.maxBytes ?? 32_000_000;
  const entries = new Map<string, { text: string; bytes: number }>();
  let bytes = 0;
  return {
    async read(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      try {
        const entry = JSON.parse(hit.text) as unknown;
        return validEntry(entry, key) ? entry : null;
      } catch { return null; }
    },
    async write(entry) {
      const text = JSON.stringify(entry);
      const size = text.length * 2;
      if (size > OPENF1_LAST_GOOD_MAX_BYTES * 2) return;
      const previous = entries.get(entry.key);
      if (previous) {
        // Never let an older observation replace a newer one.
        try { if ((JSON.parse(previous.text) as OpenF1LastGoodEntry).storedAt > entry.storedAt) return; } catch { /* replace corrupt */ }
        bytes -= previous.bytes;
        entries.delete(entry.key);
      }
      while (entries.size >= maxEntries || bytes + size > maxBytes) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        bytes -= entries.get(oldest)!.bytes;
        entries.delete(oldest);
      }
      entries.set(entry.key, { text, bytes: size });
      bytes += size;
    },
  };
}

export interface LastGoodRedisConfig { url: string; token: string }

/** Same validation as the other Upstash clients: https *.upstash.io origin only. */
export function lastGoodRedisConfig(env: Readonly<Record<string, string | undefined>> = process.env): LastGoodRedisConfig | null {
  const raw = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!raw || !token || token.length > 4096 || !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(token)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.upstash\.io$/.test(url.hostname)
      || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
    return { url: url.origin, token };
  } catch { return null; }
}

/** Upstash REST store. Every call is bounded (2 s) and failures read as a miss. */
export function createRedisLastGoodStore(config: LastGoodRedisConfig, options: { fetch?: typeof fetch; env?: Readonly<Record<string, string | undefined>> } = {}): OpenF1LastGoodStore {
  // Scoped per environment (F-07): only production reads and writes the production snapshots.
  const prefix = scopedRedisKey(REDIS_PREFIX, options.env);
  const call = (command: string[]) => requestJson<{ result?: unknown }>('openf1', config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  // Untracked like the Jolpica Redis transport: a no-store fetch seen by Next during an ISR
  // render throws "Page changed from static to dynamic at runtime" and fails the whole page.
  }, { fetchImpl: guardedRedisFetch('openf1-last-good', options.fetch ?? untrackedFetch()), timeoutMs: 2000, maxBytes: OPENF1_LAST_GOOD_MAX_BYTES + 4096 });
  return {
    async read(key) {
      if (!/^[a-f0-9]{64}$/.test(key)) return null;
      try {
        const reply = await call(['GET', `${prefix}${key}`]);
        if (typeof reply?.result !== 'string') return null;
        const entry = JSON.parse(reply.result) as unknown;
        return validEntry(entry, key) ? entry : null;
      } catch { return null; }
    },
    async write(entry) {
      if (!/^[a-f0-9]{64}$/.test(entry.key)) return;
      const text = JSON.stringify(entry);
      if (new TextEncoder().encode(text).byteLength > OPENF1_LAST_GOOD_MAX_BYTES) return;
      try { await call(['SET', `${prefix}${entry.key}`, text, 'EX', String(OPENF1_LAST_GOOD_TTL_S)]); } catch { /* best effort */ }
    },
  };
}

/** Memory first, then the shared store; writes go to both. */
export function createLayeredLastGoodStore(layers: OpenF1LastGoodStore[]): OpenF1LastGoodStore {
  return {
    async read(key) {
      let best: OpenF1LastGoodEntry | null = null;
      for (const layer of layers) {
        const entry = await layer.read(key).catch(() => null);
        if (entry && (!best || entry.storedAt > best.storedAt)) best = entry;
        if (best && layer === layers[0]) break;
      }
      if (best) await Promise.allSettled(layers.slice(0, 1).map((layer) => layer.write(best!)));
      return best;
    },
    async write(entry) {
      // An identical copy (same rows) already in the first layer is not
      // rewritten to the shared store on every render (R3-CODE-8): only the
      // in-process copy is refreshed.
      const [first, ...rest] = layers;
      if (first && rest.length) {
        const current = await first.read(entry.key).catch(() => null);
        if (current && sameRows(current.rows, entry.rows)) { await first.write(entry).catch(() => undefined); return; }
      }
      await Promise.allSettled(layers.map((layer) => layer.write(entry)));
    },
  };
}

function sameRows(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const digest = (rows: unknown[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return digest(a) === digest(b);
}

const processGlobals = globalThis as typeof globalThis & { __apexOpenF1LastGood?: OpenF1LastGoodStore };
/** The process-wide store: memory plus Redis when configured. */
export function defaultOpenF1LastGoodStore(): OpenF1LastGoodStore {
  if (!processGlobals.__apexOpenF1LastGood) {
    // `next build` keeps its snapshots in memory only: no Redis commands per build (2026-10-31).
    const redis = isBuildPhase() ? null : lastGoodRedisConfig();
    const memory = createMemoryLastGoodStore();
    processGlobals.__apexOpenF1LastGood = redis ? createLayeredLastGoodStore([memory, createRedisLastGoodStore(redis)]) : memory;
  }
  return processGlobals.__apexOpenF1LastGood;
}
