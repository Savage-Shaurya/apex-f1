// OpenNext for Cloudflare Workers (11 Nov 2026: Vercel disabled the apex-f1 project, 402).
//
// The Cloudflare account is on the Workers Free plan:
//   - KV allows 1,000 writes a day for the WHOLE account (snappycrew.com needs them) and R2 is off,
//   - one request may make at most 50 subrequests (every Cache API, asset, D1 and fetch call counts).
// So the incremental cache (ISR pages + fetch data cache) is layered to spend as few subrequests as
// possible:
//   1. this isolate's memory (free, no subrequest),
//   2. pages only: the Cache API of the data center that rendered it (kept 30 days),
//   3. the build-time copy shipped as Workers static assets (read-only; `opennextjs-cloudflare deploy`
//      copies it there because this cache reports the static-assets cache name). Data (fetch) entries
//      are read from 16 packed shards (scripts/cf-fetch-shards.mjs), one subrequest per shard.
// A stale entry is served and regenerated in the background (normal ISR stale-while-revalidate).
// No tag cache: each tag lookup would cost a D1 subrequest per cache entry. revalidateTag /
// revalidatePath from the crons therefore only clear this isolate; pages still refresh on their
// own `revalidate` times, which is what keeps the data fresh.
import { defineCloudflareConfig, getCloudflareContext } from '@opennextjs/cloudflare';
import staticAssetsCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue';

type Store = typeof staticAssetsCache;
type CacheType = Parameters<Store['get']>[1];
type Entry = { value: unknown; lastModified: number };

const KEEP_SECONDS = 30 * 24 * 3600;
const MEMORY_MAX = 400;
const memory = new Map<string, Entry>();

function remember(id: string, entry: Entry) {
  memory.delete(id);
  memory.set(id, entry);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

function urlKey(key: string, cacheType?: CacheType): string | null {
  const buildId = process.env.OPEN_NEXT_BUILD_ID ?? 'build';
  const segments = `/${buildId}/${key}.${cacheType ?? 'cache'}`.replace(/\/+/g, '/').split('/');
  if (segments.some((s) => s === '.' || s === '..')) return null;
  return `http://apex-cache.local${segments.map(encodeURIComponent).join('/')}`;
}

let opened: Promise<Cache> | undefined;
const regional = () => (opened ??= caches.open('apex-incremental'));

// Build-time fetch entries, packed into 16 shards by scripts/cf-fetch-shards.mjs (one subrequest each).
const shards = new Map<string, Promise<Record<string, unknown>>>();
function shardFor(key: string): Promise<Record<string, unknown>> {
  const name = key[0]?.toLowerCase() ?? '_';
  let shard = shards.get(name);
  if (!shard) {
    const buildId = process.env.OPEN_NEXT_BUILD_ID ?? 'build';
    const assets = getCloudflareContext().env.ASSETS as { fetch(url: string): Promise<Response> };
    shard = assets
      .fetch(`http://assets.local/cdn-cgi/_apex_fetch/${encodeURIComponent(buildId)}/${encodeURIComponent(name)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : {}))
      .catch(() => ({}));
    shards.set(name, shard);
  }
  return shard;
}

const edgeCache = {
  // Same name as the static-assets cache so the deploy step copies the build cache into the assets.
  name: staticAssetsCache.name,
  async get(key: string, cacheType?: CacheType) {
    if (cacheType === 'composable') return null;
    const id = `${cacheType ?? 'cache'}:${key}`;
    const inMemory = memory.get(id);
    if (inMemory) return inMemory;
    if (cacheType !== 'fetch') {
      try {
        const k = urlKey(key, cacheType);
        const hit = k ? await (await regional()).match(k) : undefined;
        if (hit) {
          const entry = (await hit.json()) as Entry;
          remember(id, entry);
          return entry;
        }
      } catch {
        // fall through to the build copy
      }
    }
    if (cacheType === 'fetch') {
      const value = (await shardFor(key))[key];
      if (!value) return null;
      const entry: Entry = { value, lastModified: (globalThis as { __BUILD_TIMESTAMP_MS__?: number }).__BUILD_TIMESTAMP_MS__ ?? 0 };
      remember(id, entry);
      return entry;
    }
    const built = (await staticAssetsCache.get(key, cacheType)) as Entry | null;
    if (built) remember(id, built);
    return built;
  },
  async set(key: string, value: unknown, cacheType?: CacheType) {
    if (cacheType === 'composable') return;
    const entry: Entry = { value, lastModified: Date.now() };
    remember(`${cacheType ?? 'cache'}:${key}`, entry);
    if (cacheType === 'fetch') return;
    const k = urlKey(key, cacheType);
    if (!k) return;
    try {
      const put = (await regional()).put(k, new Response(JSON.stringify(entry), { headers: { 'cache-control': `max-age=${KEEP_SECONDS}` } }));
      getCloudflareContext().ctx.waitUntil(put.catch(() => undefined));
    } catch (e) {
      console.error('apex incremental cache: set failed', e);
    }
  },
  async delete(key: string) {
    memory.delete(`cache:${key}`);
    const k = urlKey(key, 'cache');
    if (!k) return;
    try {
      await (await regional()).delete(k);
    } catch {
      // nothing to delete
    }
  },
} as unknown as Store;

export default defineCloudflareConfig({
  incrementalCache: edgeCache,
  queue: doQueue,
});
