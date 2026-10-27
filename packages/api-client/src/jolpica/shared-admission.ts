import { randomUUID } from "node:crypto";
import { ProviderError, requestJson, untrackedFetch, withProviderDeadline } from "../transport";
import { scopedRedisKey } from "../redis-scope";
import { isBuildPhase } from "../build-phase";

export interface JolpicaRedisConfig {
  url: string;
  token: string;
}
export interface JolpicaSharedAdmission {
  /** `scope` is the endpoint class (jolpicaRateLimitScope): only that class's 429 pause blocks it. */
  reserve(
    owner: string,
    signal: AbortSignal,
    scope?: string,
  ): Promise<{ admitted: boolean; retryMs: number; remainingMs: number }>;
  complete(owner: string, signal: AbortSignal): Promise<void>;
  /** Ask every process to pause new starts of one endpoint class (after an HTTP 429). */
  backoff?(ms: number, signal: AbortSignal, scope?: string): Promise<void>;
}
export const JOLPICA_SHARED_GAP_MS = 260;
export const JOLPICA_SHARED_HOUR_LIMIT = 500;
/** Safety lease for one physical request whose transport may still be settling. */
export const JOLPICA_DISPATCH_MS = 35_000;
/** Physical requests that may be in flight at once across every process. */
export const JOLPICA_MAX_CONCURRENT_DISPATCHES = 3;
/** The production deployment's prefix. Every other environment is scoped (jolpicaRedisPrefix, F-07). */
export const JOLPICA_REDIS_PREFIX = "apex:jolpica:v1:{jolpica}";
/** This process's prefix: the production keys only on the production deployment (redis-scope.ts). */
export function jolpicaRedisPrefix(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return scopedRedisKey(JOLPICA_REDIS_PREFIX, env);
}
/**
 * The request budget's prefix (quota, start gap, leases, backoff). `next build` runs on other
 * machines than the live functions and gets its own budget: three production prerenders in one
 * hour spent the live site's 500 starts and its uncached pages answered 500 (2026-10-27).
 * Snapshots and last-good copies stay shared (jolpicaRedisPrefix).
 */
export function jolpicaAdmissionPrefix(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const prefix = jolpicaRedisPrefix(env);
  if (!isBuildPhase(env)) return prefix;
  return prefix.replace(/^apex:(?:([a-z0-9-]+):)?jolpica:/, (_, scope?: string) => `apex:${scope ? `${scope}-` : ""}build:jolpica:`);
}
const SCOPE_LABEL = /^[a-z0-9-]{1,40}$/;
function backoffKey(prefix: string, scope: string | undefined): string {
  if (scope !== undefined && !SCOPE_LABEL.test(scope)) throw new ProviderError("jolpica", "invalid-input");
  return scope ? `${prefix}:backoff:${scope}` : `${prefix}:backoff`;
}
export const JOLPICA_REDIS_CLOCK =
  "local clock=redis.call('TIME'); local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)";
/**
 * KEYS: quota (zset of starts), last (start time), dispatch (zset of owner ->
 * lease expiry), backoff (429 pause). A finished request removes its own
 * lease, so one failure no longer blocks every other read for 35 seconds;
 * only transports that may still be running keep theirs until it expires.
 */
export const JOLPICA_RESERVE_SCRIPT = `
${JOLPICA_REDIS_CLOCK}
local paused=redis.call('PTTL',KEYS[4]); if paused>0 then return {0,paused,0} end
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now)
if redis.call('ZCARD',KEYS[3])>=${JOLPICA_MAX_CONCURRENT_DISPATCHES} then
 local soonest=redis.call('ZRANGE',KEYS[3],0,0,'WITHSCORES'); return {0,math.max(1,tonumber(soonest[2])-now),0}
end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-3600000)
local delay=math.max(0,tonumber(redis.call('GET',KEYS[2]) or '0')+${JOLPICA_SHARED_GAP_MS}-now)
if redis.call('ZCARD',KEYS[1])>=${JOLPICA_SHARED_HOUR_LIMIT} then
 local first=redis.call('ZRANGE',KEYS[1],0,0,'WITHSCORES'); delay=math.max(delay,tonumber(first[2])+3600001-now)
end
if delay>0 then return {0,delay,0} end
redis.call('ZADD',KEYS[1],now,ARGV[1]); redis.call('PEXPIRE',KEYS[1],3600001)
redis.call('SET',KEYS[2],now,'PX',3600001)
redis.call('ZADD',KEYS[3],now+${JOLPICA_DISPATCH_MS},ARGV[1]); redis.call('PEXPIRE',KEYS[3],${JOLPICA_DISPATCH_MS})
return {1,0,${JOLPICA_DISPATCH_MS}}`;
export const JOLPICA_COMPLETE_SCRIPT =
  "redis.call('ZREM',KEYS[1],ARGV[1]); return 1";
/** Longest pause one 429 can impose on every process (for its endpoint class only). */
export const JOLPICA_MAX_BACKOFF_MS = 120_000;
export const JOLPICA_BACKOFF_SCRIPT =
  "local current=redis.call('PTTL',KEYS[1]); if current<tonumber(ARGV[1]) then redis.call('SET',KEYS[1],'1','PX',ARGV[1]) end; return 1";

export function jolpicaRedisConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JolpicaRedisConfig | null {
  const raw = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (
    !raw ||
    !token ||
    token.length > 4096 ||
    !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(token)
  )
    return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.upstash\.io$/.test(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return { url: url.origin, token };
  } catch {
    return null;
  }
}
export function createJolpicaRedisTransport(
  config: JolpicaRedisConfig,
  options: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
) {
  if (
    !jolpicaRedisConfig({
      UPSTASH_REDIS_REST_URL: config.url,
      UPSTASH_REDIS_REST_TOKEN: config.token,
    })
  )
    throw new ProviderError("jolpica", "configuration");
  return async (command: string[], signal: AbortSignal): Promise<unknown> => {
    const result = await requestJson<unknown>(
      "jolpica",
      config.url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
      },
      {
        signal,
        // Admission EVALs are control traffic: never cached by Next and never
        // a reason to render a page dynamically.
        fetchImpl: options.fetch ?? untrackedFetch(),
        timeoutMs: options.timeoutMs ?? 2000,
        maxBytes: options.maxBytes ?? 4_100_000,
      },
    );
    if (
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      "error" in result ||
      !("result" in result)
    )
      throw new ProviderError("jolpica", "configuration");
    return (result as { result: unknown }).result;
  };
}
export function createJolpicaSharedAdmission(
  config: JolpicaRedisConfig,
  options: {
    fetch?: typeof fetch;
    prefix?: string;
    monotonic?: () => number;
    /** Environment used for the key scope (default process.env). */
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): JolpicaSharedAdmission {
  const prefix = options.prefix ?? jolpicaAdmissionPrefix(options.env);
  if (!/^apex:(?:[a-z0-9-]{1,48}:)?jolpica:v1:\{jolpica(?:-[a-z0-9-]{1,100})?\}$/.test(prefix))
    throw new ProviderError("jolpica", "invalid-input");
  const execute = createJolpicaRedisTransport(config, options);
  const monotonic = options.monotonic ?? (() => performance.now());
  const ownerCheck = (owner: string) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner))
      throw new ProviderError("jolpica", "invalid-input");
  };
  return {
    async reserve(owner, signal, scope) {
      ownerCheck(owner);
      const before = monotonic();
      const value = await execute(
        [
          "EVAL",
          JOLPICA_RESERVE_SCRIPT,
          "4",
          `${prefix}:quota`,
          `${prefix}:last`,
          `${prefix}:dispatches`,
          backoffKey(prefix, scope),
          owner,
        ],
        signal,
      );
      const elapsed = Math.max(0, monotonic() - before);
      if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        ![0, 1].includes(value[0]) ||
        !Number.isSafeInteger(value[1]) ||
        value[1] < 0 ||
        value[1] > 3_600_001 ||
        !Number.isSafeInteger(value[2]) ||
        value[2] < 0 ||
        value[2] > JOLPICA_DISPATCH_MS ||
        (value[0] === 1 &&
          (value[1] !== 0 || value[2] !== JOLPICA_DISPATCH_MS)) ||
        (value[0] === 0 && (value[1] < 1 || value[2] !== 0))
      )
        throw new ProviderError("jolpica", "configuration");
      return {
        admitted: value[0] === 1,
        retryMs: value[1],
        remainingMs: Math.max(0, value[2] - elapsed - 10),
      };
    },
    async complete(owner, signal) {
      ownerCheck(owner);
      const value = await execute(
        ["EVAL", JOLPICA_COMPLETE_SCRIPT, "1", `${prefix}:dispatches`, owner],
        signal,
      );
      if (value !== 1) throw new ProviderError("jolpica", "configuration");
    },
    async backoff(ms, signal, scope) {
      const pause = Math.round(Math.min(JOLPICA_MAX_BACKOFF_MS, Math.max(1000, ms)));
      const value = await execute(
        ["EVAL", JOLPICA_BACKOFF_SCRIPT, "1", backoffKey(prefix, scope), String(pause)],
        signal,
      );
      if (value !== 1) throw new ProviderError("jolpica", "configuration");
    },
  };
}
export const jolpicaAdmissionOwner = () => randomUUID();
export const completeJolpicaAdmission = (
  store: JolpicaSharedAdmission,
  owner: string,
) =>
  withProviderDeadline("jolpica", (signal) => store.complete(owner, signal), {
    timeoutMs: 2000,
  });

/** Only completed archives are fenced by these two epochs. Current-season
 * refreshes do not invalidate historical champions or erase quota history. */
export async function invalidateSharedJolpicaChampionships(
  season: number,
  config: JolpicaRedisConfig | null = jolpicaRedisConfig(),
  options: { fetch?: typeof fetch; finished?: boolean; env?: Readonly<Record<string, string | undefined>> } = {},
): Promise<void> {
  if (
    !Number.isSafeInteger(season) ||
    season < 1950 ||
    season > new Date().getUTCFullYear() + 1
  )
    throw new ProviderError("jolpica", "invalid-input");
  // A season enters the champions archive once its final round is classified,
  // which can be this calendar year (December). The caller confirms that with
  // `finished`; an unfinished current season never touches the epochs.
  const year = new Date().getUTCFullYear();
  if (season > year || (season === year && !options.finished)) return;
  if (!config) {
    if (process.env.NODE_ENV === "production")
      throw new ProviderError("jolpica", "configuration");
    return;
  }
  const execute = createJolpicaRedisTransport(config, options);
  await withProviderDeadline(
    "jolpica",
    async (signal) => {
      const kinds = season >= 1958 ? ["driver", "constructor"] : ["driver"];
      const keys = kinds.map(
        (kind) => `${jolpicaRedisPrefix(options.env)}:championship:epoch:${kind}`,
      );
      const value = await execute(
        [
          "EVAL",
          "for _,key in ipairs(KEYS) do redis.call('INCR',key) end; return #KEYS",
          String(keys.length),
          ...keys,
        ],
        signal,
      );
      if (value !== keys.length)
        throw new ProviderError("jolpica", "configuration");
    },
    { timeoutMs: 2000 },
  );
}
