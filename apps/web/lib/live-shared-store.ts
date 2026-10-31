import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import { guardedRedisFetch, redisDeadlineReason, redisFailureOf, RedisUnavailableError } from '../../../packages/api-client/src/redis-guard';
import { MAX_LIVE_SNAPSHOT_BYTES, sanitizeLiveFrames } from './live-frame-schema';
import type { LiveFrame } from './live-session-hub';
import { randomUUID } from 'node:crypto';

export const LIVE_LEASE_MS = 15_000;
export const LIVE_REQUEST_GAP_MS = 2_300;
export const LIVE_REQUESTS_PER_MINUTE = 26;
export interface LiveSharedSnapshot { version: 1; fence: number; revision: number; writtenAt: number; frames: LiveFrame[] }
export interface LiveSharedStore {
  claim(owner: string, signal: AbortSignal): Promise<{ owner: boolean; fence: number }>;
  reserve(owner: string, fence: number, signal: AbortSignal): Promise<{ owned: boolean; retryMs: number }>;
  publish(owner: string, fence: number, frames: LiveFrame[], signal: AbortSignal): Promise<LiveSharedSnapshot | null>;
  read(signal: AbortSignal): Promise<LiveSharedSnapshot | null>;
  release(owner: string, fence: number, signal: AbortSignal): Promise<void>;
  complete?(owner: string, fence: number, signal: AbortSignal): Promise<void>;
}
export interface LiveStoreConfig { url: string; token: string }
// Scoped per environment (F-07): only production spends the production OpenF1 budget.
const PREFIX = scopedRedisKey('apex:live:v1:{openf1}');
export const OPENF1_QUOTA_KEYS = { quota: `${PREFIX}:quota`, last: `${PREFIX}:last`, dispatch: `${PREFIX}:dispatch` };
const keys = { lease: `${PREFIX}:owner`, fence: `${PREFIX}:fence`, ...OPENF1_QUOTA_KEYS, snapshot: `${PREFIX}:snapshot`, revision: `${PREFIX}:revision` };
const CLOCK = "local clock = redis.call('TIME'); local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)";
const OWNED = "redis.call('GET', KEYS[1]) == ARGV[1] and tonumber(redis.call('GET', KEYS[2]) or '0') == tonumber(ARGV[2]) and redis.call('PTTL', KEYS[1]) > 0";
const CLAIM = `
local current = redis.call('GET', KEYS[1])
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ${LIVE_LEASE_MS})
  return {1, tonumber(redis.call('GET', KEYS[2]) or '0')}
end
if current then return {0, tonumber(redis.call('GET', KEYS[2]) or '0')} end
local fence = redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[1], ARGV[1], 'PX', ${LIVE_LEASE_MS})
return {1, fence}`;
const RESERVE = `
if not (${OWNED}) then return {0, 0} end
redis.call('PEXPIRE', KEYS[1], ${LIVE_LEASE_MS})
${CLOCK}
local dispatch = redis.call('PTTL', KEYS[5])
if dispatch > 0 then return {1, dispatch} end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - 60000)
local count = redis.call('ZCARD', KEYS[3])
local delay = math.max(0, tonumber(redis.call('GET', KEYS[4]) or '0') + ${LIVE_REQUEST_GAP_MS} - now)
if count >= ${LIVE_REQUESTS_PER_MINUTE} then
  local first = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  delay = math.max(delay, tonumber(first[2]) + 60001 - now)
end
if delay > 0 then return {1, delay} end
redis.call('ZADD', KEYS[3], now, tostring(now))
redis.call('PEXPIRE', KEYS[3], 61000)
redis.call('SET', KEYS[4], now, 'PX', 61000)
redis.call('SET', KEYS[5], ARGV[3], 'PX', 20000)
return {1, 0}`;
const COMPLETE = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ${LIVE_REQUEST_GAP_MS}) end; return 1`;
const PUBLISH = `
if not (${OWNED}) then return nil end
${CLOCK}
local revision = redis.call('INCR', KEYS[4])
redis.call('PEXPIRE', KEYS[1], ${LIVE_LEASE_MS})
-- Preserve JSON empty arrays; Redis cjson re-encoding can turn them into objects.
local snapshot = '{"version":1,"fence":' .. ARGV[2] .. ',"revision":' .. tostring(revision) .. ',"writtenAt":' .. string.format('%.0f', now) .. ',"frames":' .. ARGV[3] .. '}'
redis.call('SET', KEYS[3], snapshot, 'PX', 120000)
return snapshot`;
// Keep a short handoff gap after the release reaches Redis. A preceding REST
// reservation can arrive at its owner later than Redis's clock; immediate DEL
// would let a successor start beside that owner's last real provider request.
const RELEASE = `if ${OWNED} then redis.call('PEXPIRE', KEYS[1], ${LIVE_REQUEST_GAP_MS}) end; return 1`;

/** Same strict credential/origin rules as the existing shared rate limiter. */
export function liveStoreConfig(env: Readonly<Record<string, string | undefined>> = process.env): LiveStoreConfig | null {
  const raw = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!raw || !token || token.length > 4_096 || !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(token)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.upstash\.io$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) return null;
    return { url: url.origin, token };
  } catch { return null; }
}

export function mayUseProcessLiveHub(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV === 'development' && !env.VERCEL && !env.VERCEL_ENV;
}

function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
export function parseLiveSharedSnapshot(value: unknown): LiveSharedSnapshot | null {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_LIVE_SNAPSHOT_BYTES) return null;
  try {
    const input: unknown = JSON.parse(value);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const snapshot = input as Record<string, unknown>;
    const frames = sanitizeLiveFrames(snapshot.frames);
    if (snapshot.version !== 1 || !positive(snapshot.fence) || !positive(snapshot.revision) || !positive(snapshot.writtenAt) || !frames || !frames.length) return null;
    return { version: 1, fence: snapshot.fence, revision: snapshot.revision, writtenAt: snapshot.writtenAt, frames };
  } catch { return null; }
}

/** Each entire HTTPS/body operation has a hard deadline, including stalled readers. */
export function createUpstashRedisTransport(config: LiveStoreConfig, options: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}) {
  const validated = liveStoreConfig({ UPSTASH_REDIS_REST_URL: config.url, UPSTASH_REDIS_REST_TOKEN: config.token });
  if (!validated) throw new TypeError('Invalid live store configuration');
  // Untracked: Redis coordination is not page data. A no-store fetch seen by Next during an
  // ISR render throws "Page changed from static to dynamic at runtime" and fails the page.
  // Guarded (redis-guard.ts): quota/auth/outage replies open this process's breaker.
  const fetcher = guardedRedisFetch('live-store', options.fetch);
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_000) throw new TypeError('Invalid live store deadline');
  const maxBytes = options.maxBytes ?? 196_608;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000) throw new TypeError('Invalid shared response bound');
  let syncToken: string | null = null;
  let tail = Promise.resolve();
  const execute = async (command: string[], signal: AbortSignal): Promise<unknown> => {
    signal.throwIfAborted();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interrupt: (error: Error) => void = () => {};
    const deadline = new Promise<never>((_resolve, reject) => {
      interrupt = reject;
      // A store that does not answer in time is unavailable Redis, not our bug (redis-guard.ts).
      timer = setTimeout(() => { controller.abort(redisDeadlineReason()); reject(new RedisUnavailableError('redis-unavailable', 'live-store')); }, timeoutMs);
    });
    // The caller's cancellation (client disconnect, page deadline) is never a Redis failure (R-02).
    const abort = () => { controller.abort(new DOMException('Caller cancelled', 'AbortError')); interrupt(new Error('Live shared store unavailable')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    // Opaque causal tokens cannot be compared. Serialize commands, including
    // release/refresh overlap, so an older response never replaces a newer token.
    // The deadline started above also covers waiting in this queue.
    const previous = tail;
    let finish = () => {};
    tail = new Promise<void>((resolve) => { finish = resolve; });
    const operation = (async () => {
      await previous;
      controller.signal.throwIfAborted();
      const headers: Record<string, string> = { authorization: `Bearer ${validated.token}`, 'content-type': 'application/json' };
      if (syncToken !== null) headers['upstash-sync-token'] = syncToken;
      const response = await fetcher(validated.url, { method: 'POST', headers, body: JSON.stringify(command), signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error('Live shared store unavailable');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        controller.signal.throwIfAborted();
        for (;;) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new Error('Live shared store unavailable');
          chunks.push(value);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
      if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data || !('result' in data)) throw new Error('Live shared store unavailable');
      controller.signal.throwIfAborted();
      const nextToken = response.headers.get('upstash-sync-token');
      if (nextToken !== null) {
        if (!nextToken.length || nextToken.length > 4_096 || !/^[\x20-\x7e]+$/.test(nextToken)) throw new Error('Live shared store unavailable');
        syncToken = nextToken;
      }
      return (data as { result: unknown }).result;
    })();
    try { return await Promise.race([operation, deadline]); }
    // The Redis failure (if any) rides along as `cause`, so callers can degrade to local work.
    catch (error) { const redis = redisFailureOf(error); throw redis ? new Error('Live shared store unavailable', { cause: redis }) : new Error('Live shared store unavailable'); }
    finally {
      clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort();
      // A canceled queued command cannot open the gate past its still-active
      // predecessor. Its own caller settles immediately; the queue stays ordered.
      void previous.then(finish);
    }
  };
  return execute;
}

export function createUpstashLiveSharedStore(config: LiveStoreConfig, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): LiveSharedStore {
  const execute = createUpstashRedisTransport(config, options);
  const dispatches = new Map<string, string>();
  const evalScript = (script: string, scriptKeys: string[], args: string[], signal: AbortSignal) => execute(['EVAL', script, String(scriptKeys.length), ...scriptKeys, ...args], signal);
  const identity = (owner: string, fence?: number) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner) || (fence !== undefined && !positive(fence))) throw new TypeError('Invalid live owner');
  };
  return {
    async claim(owner, signal) {
      identity(owner);
      const result = await evalScript(CLAIM, [keys.lease, keys.fence], [owner], signal);
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !positive(result[1])) throw new Error('Live shared store unavailable');
      return { owner: result[0] === 1, fence: result[1] };
    },
    async reserve(owner, fence, signal) {
      identity(owner, fence);
      const dispatch = randomUUID();
      const result = await evalScript(RESERVE, [keys.lease, keys.fence, keys.quota, keys.last, keys.dispatch], [owner, String(fence), dispatch], signal);
      if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(result[0]) || !Number.isSafeInteger(result[1]) || result[1] < 0 || result[1] > 60_001) throw new Error('Live shared store unavailable');
      if (result[0] === 1 && result[1] === 0) {
        if (dispatches.size >= 64) dispatches.delete(dispatches.keys().next().value!);
        dispatches.set(`${owner}:${fence}`, dispatch);
      }
      return { owned: result[0] === 1, retryMs: result[1] };
    },
    async publish(owner, fence, frames, signal) {
      identity(owner, fence);
      const clean = sanitizeLiveFrames(frames);
      if (!clean || !clean.length) throw new TypeError('Invalid live frames');
      const result = await evalScript(PUBLISH, [keys.lease, keys.fence, keys.snapshot, keys.revision], [owner, String(fence), JSON.stringify(clean)], signal);
      if (result === null) return null;
      const snapshot = parseLiveSharedSnapshot(result);
      if (!snapshot || snapshot.fence !== fence) throw new Error('Live shared store unavailable');
      return snapshot;
    },
    async read(signal) {
      const result = await execute(['GET', keys.snapshot], signal);
      if (result === null) return null;
      const snapshot = parseLiveSharedSnapshot(result);
      if (!snapshot) throw new Error('Live shared store unavailable');
      return snapshot;
    },
    async release(owner, fence, signal) { identity(owner, fence); dispatches.delete(`${owner}:${fence}`); await evalScript(RELEASE, [keys.lease, keys.fence], [owner, String(fence)], signal); },
    async complete(owner, fence, signal) {
      identity(owner, fence); const key = `${owner}:${fence}`; const dispatch = dispatches.get(key); dispatches.delete(key);
      if (dispatch) await evalScript(COMPLETE, [keys.dispatch], [dispatch], signal);
    },
  };
}
