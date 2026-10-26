import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import { createUpstashRedisTransport, LIVE_REQUEST_GAP_MS, LIVE_REQUESTS_PER_MINUTE, OPENF1_QUOTA_KEYS, type LiveStoreConfig } from './live-shared-store';
import { liveSourceFreshnessMs, validateLiveSourceSnapshot, type LiveSourceSnapshot } from './live-source-snapshot';

export const MAX_OPENF1_CACHE_BYTES = 1_000_000;
export interface OpenF1CachedRows { version: 1; query: string; writtenAt: number; rows: unknown[] }
export interface OpenF1ReadStore {
  read(query: string, signal: AbortSignal): Promise<OpenF1CachedRows | null>;
  claim(query: string, owner: string, signal: AbortSignal): Promise<{ owner: boolean; fence: number; retryMs: number }>;
  admit(owner: string, signal: AbortSignal): Promise<{ retryMs: number; busy: boolean }>;
  publish(query: string, owner: string, fence: number, rows: unknown[], ttlMs: number, signal: AbortSignal): Promise<OpenF1CachedRows | null>;
  release(query: string, owner: string, fence: number, signal: AbortSignal): Promise<void>;
  complete(owner: string, signal: AbortSignal): Promise<void>;
  readSource?(query: string, signal: AbortSignal): Promise<LiveSourceSnapshot | null>;
  publishSource?(query: string, owner: string, fence: number, snapshot: LiveSourceSnapshot, ttlMs: number, signal: AbortSignal): Promise<LiveSourceSnapshot | null>;
  publishLiveSource?(query: string, owner: string, fence: number, liveOwner: string, liveFence: number, snapshot: LiveSourceSnapshot, ttlMs: number, signal: AbortSignal): Promise<LiveSourceSnapshot | null>;
}
const PREFIX = scopedRedisKey('apex:live:v1:{openf1}:read:');
const CLOCK = "local clock = redis.call('TIME'); local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)";
const CLAIM = `
local current = redis.call('GET', KEYS[1])
if current then return {0, tonumber(redis.call('GET', KEYS[2]) or '0'), math.max(1, redis.call('PTTL', KEYS[1]))} end
local fence = redis.call('INCR', KEYS[2]); redis.call('PEXPIRE', KEYS[2], 600000)
redis.call('SET', KEYS[1], ARGV[1], 'PX', 25000)
return {1, fence, 0}`;
const ADMIT = `
${CLOCK}
local active = redis.call('PTTL', KEYS[3]); if active > 0 then return {active, 1} end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60000)
local count = redis.call('ZCARD', KEYS[1])
local delay = math.max(0, tonumber(redis.call('GET', KEYS[2]) or '0') + ${LIVE_REQUEST_GAP_MS} - now)
if count >= ${LIVE_REQUESTS_PER_MINUTE} then local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES'); delay = math.max(delay, tonumber(first[2]) + 60001 - now) end
if delay > 0 then return {delay, 0} end
redis.call('ZADD', KEYS[1], now, tostring(now)); redis.call('PEXPIRE', KEYS[1], 61000)
redis.call('SET', KEYS[2], now, 'PX', 61000); redis.call('SET', KEYS[3], ARGV[1], 'PX', 20000)
return {0, 0}`;
const PUBLISH = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] or tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) or redis.call('PTTL', KEYS[1]) <= 0 then return nil end
${CLOCK}
local data = '{"version":1,"query":"' .. ARGV[3] .. '","writtenAt":' .. string.format('%.0f', now) .. ',"rows":' .. ARGV[4] .. '}'
redis.call('SET', KEYS[3], data, 'PX', ARGV[5]); return data`;
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] and tonumber(redis.call('GET', KEYS[2]) or '0') == tonumber(ARGV[2]) then redis.call('DEL', KEYS[1]) end; return 1";
const COMPLETE = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ${LIVE_REQUEST_GAP_MS}) end; return 1`;
/** Source data shares the query lock with SSR refreshes. Every key keeps the
 * same Redis cluster hash tag; live writers additionally prove hub ownership. */
const SOURCE_QUERY_OWNED = "redis.call('GET', KEYS[1]) == ARGV[1] and tonumber(redis.call('GET', KEYS[2]) or '0') == tonumber(ARGV[2]) and redis.call('PTTL', KEYS[1]) > 0";
const SOURCE_WRITE = `
${CLOCK}
local incoming = cjson.decode(ARGV[3])
local expiry = tonumber(ARGV[5])
if expiry <= now or incoming.acquisitionCompletedAt > now + 5000 then return nil end
local existing = redis.call('GET', KEYS[3])
if existing then
  local ok, current = pcall(cjson.decode, existing)
  if not ok or type(current) ~= 'table' or current.kind ~= 'live-source' or current.query ~= incoming.query
    or type(current.acquisitionStartedAt) ~= 'number' or type(current.acquisitionCompletedAt) ~= 'number' then return nil end
  -- A slow older request cannot overwrite a source acquired by a newer request.
  if current.acquisitionStartedAt > incoming.acquisitionStartedAt
    or (current.acquisitionStartedAt == incoming.acquisitionStartedAt and current.acquisitionCompletedAt >= incoming.acquisitionCompletedAt) then return nil end
end
local lifetime = math.min(tonumber(ARGV[4]), expiry - now)
if lifetime <= 0 then return nil end
-- Preserve original JSON arrays, dates and per-row coverage provenance.
redis.call('SET', KEYS[3], ARGV[3], 'PX', lifetime)
return ARGV[3]`;
const PUBLISH_SOURCE = `if not (${SOURCE_QUERY_OWNED}) then return nil end
${SOURCE_WRITE}`;
const PUBLISH_LIVE_SOURCE = `if not (${SOURCE_QUERY_OWNED}) then return nil end
if redis.call('GET', KEYS[4]) ~= ARGV[6] or tonumber(redis.call('GET', KEYS[5]) or '0') ~= tonumber(ARGV[7]) or redis.call('PTTL', KEYS[4]) <= 0 then return nil end
${SOURCE_WRITE}`;
const LIVE_SOURCE_KEYS = [scopedRedisKey('apex:live:v1:{openf1}:owner'), scopedRedisKey('apex:live:v1:{openf1}:fence')];
function queryKeys(query: string) {
  if (!/^[a-f0-9]{64}$/.test(query)) throw new TypeError('Invalid OpenF1 cache identity');
  return [`${PREFIX}${query}:lock`, `${PREFIX}${query}:fence`, `${PREFIX}${query}:cache`];
}
function identity(owner: string, fence?: number) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner) || (fence !== undefined && (!Number.isSafeInteger(fence) || fence <= 0))) throw new TypeError('Invalid OpenF1 cache owner');
}
export function parseOpenF1CachedRows(value: unknown, query: string): OpenF1CachedRows | null {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_OPENF1_CACHE_BYTES + 200) return null;
  try {
    const data = JSON.parse(value) as OpenF1CachedRows;
    if (data.version !== 1 || data.query !== query || !Number.isSafeInteger(data.writtenAt) || data.writtenAt <= 0 || !Array.isArray(data.rows) || data.rows.length > 10000) return null;
    return { version: 1, query, writtenAt: data.writtenAt, rows: data.rows };
  } catch { return null; }
}
export function createUpstashOpenF1ReadStore(config: LiveStoreConfig, options: { fetch?: typeof fetch; timeoutMs?: number } = {}): OpenF1ReadStore {
  const execute = createUpstashRedisTransport(config, { ...options, maxBytes: 2_000_000 });
  const run = (script: string, keys: string[], args: string[], signal: AbortSignal) => execute(['EVAL', script, String(keys.length), ...keys, ...args], signal);
  const decodeSource = async (value: unknown, query: string, signal: AbortSignal) => {
    if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_OPENF1_CACHE_BYTES) throw new Error('OpenF1 source snapshot unavailable');
    let snapshot: LiveSourceSnapshot;
    try { snapshot = JSON.parse(value) as LiveSourceSnapshot; } catch { throw new Error('OpenF1 source snapshot unavailable'); }
    if (!snapshot || snapshot.query !== query) throw new Error('OpenF1 source snapshot unavailable');
    return validateLiveSourceSnapshot(snapshot, { endpoint: snapshot.endpoint, sessionKey: snapshot.sessionKey }, Date.now(), signal);
  };
  const sourceArguments = async (query: string, owner: string, fence: number, snapshot: LiveSourceSnapshot, ttlMs: number, signal: AbortSignal) => {
    queryKeys(query); identity(owner, fence);
    if (!snapshot || snapshot.query !== query) throw new TypeError('Invalid OpenF1 source snapshot identity');
    const verified = await validateLiveSourceSnapshot(snapshot, { endpoint: snapshot.endpoint, sessionKey: snapshot.sessionKey }, Date.now(), signal);
    const ceiling = liveSourceFreshnessMs(verified.endpoint);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > ceiling) throw new TypeError('Invalid OpenF1 source snapshot lifetime');
    return [owner, String(fence), JSON.stringify(verified), String(ttlMs), String(verified.acquisitionStartedAt + ceiling)];
  };
  return {
    async read(query, signal) {
      const value = await execute(['GET', queryKeys(query)[2]!], signal);
      if (value === null) return null;
      const data = parseOpenF1CachedRows(value, query); if (!data) throw new Error('OpenF1 shared read unavailable'); return data;
    },
    async claim(query, owner, signal) {
      identity(owner); const value = await run(CLAIM, queryKeys(query).slice(0, 2), [owner], signal);
      if (!Array.isArray(value) || value.length !== 3 || ![0, 1].includes(value[0]) || !Number.isSafeInteger(value[1]) || value[1] <= 0 || !Number.isSafeInteger(value[2]) || value[2] < 0 || value[2] > 25000) throw new Error('OpenF1 shared read unavailable');
      return { owner: value[0] === 1, fence: value[1], retryMs: value[2] };
    },
    async admit(owner, signal) {
      identity(owner); const value = await run(ADMIT, [OPENF1_QUOTA_KEYS.quota, OPENF1_QUOTA_KEYS.last, OPENF1_QUOTA_KEYS.dispatch], [owner], signal);
      if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || value[0] < 0 || value[0] > 60001 || ![0, 1].includes(value[1])) throw new Error('OpenF1 shared read unavailable'); return { retryMs: value[0], busy: value[1] === 1 };
    },
    async publish(query, owner, fence, rows, ttlMs, signal) {
      identity(owner, fence); const json = JSON.stringify(rows);
      if (!Array.isArray(rows) || rows.length > 10000 || new TextEncoder().encode(json).byteLength > MAX_OPENF1_CACHE_BYTES || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 600000) throw new TypeError('Invalid OpenF1 cache payload');
      const value = await run(PUBLISH, queryKeys(query), [owner, String(fence), query, json, String(ttlMs)], signal);
      if (value === null) return null;
      const data = parseOpenF1CachedRows(value, query); if (!data) throw new Error('OpenF1 shared read unavailable'); return data;
    },
    async release(query, owner, fence, signal) { identity(owner, fence); await run(RELEASE, queryKeys(query).slice(0, 2), [owner, String(fence)], signal); },
    async complete(owner, signal) { identity(owner); await run(COMPLETE, [OPENF1_QUOTA_KEYS.dispatch], [owner], signal); },
    async readSource(query, signal) {
      const value = await execute(['GET', queryKeys(query)[2]!], signal);
      return value === null ? null : decodeSource(value, query, signal);
    },
    async publishSource(query, owner, fence, snapshot, ttlMs, signal) {
      const args = await sourceArguments(query, owner, fence, snapshot, ttlMs, signal);
      const value = await run(PUBLISH_SOURCE, queryKeys(query), args, signal);
      return value === null ? null : decodeSource(value, query, signal);
    },
    async publishLiveSource(query, owner, fence, liveOwner, liveFence, snapshot, ttlMs, signal) {
      identity(liveOwner, liveFence);
      const args = await sourceArguments(query, owner, fence, snapshot, ttlMs, signal);
      const value = await run(PUBLISH_LIVE_SOURCE, [...queryKeys(query), ...LIVE_SOURCE_KEYS], [...args, liveOwner, String(liveFence)], signal);
      return value === null ? null : decodeSource(value, query, signal);
    },
  };
}
