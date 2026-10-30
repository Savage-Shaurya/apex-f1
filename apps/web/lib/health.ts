import { resolveProviderBase } from '../../../packages/api-client/src/provider-base';
import { guardedRedisFetch, redisBreakerOpen } from '../../../packages/api-client/src/redis-guard';

/**
 * Health checks behind /api/health. Each probe is bounded (2.5 s), runs in
 * parallel, and reports only a status word and a latency: no hostnames,
 * connection strings, tokens or upstream error text ever leave this module.
 *
 * - the database is required: down makes the service "down" (503); on a
 *   production deployment a missing database counts as down.
 * - Redis is optional (2026-10-31): down (including a spent Upstash quota,
 *   which this process's breaker remembers) makes it "degraded" (200), and
 *   "not-configured" is reported honestly without degrading anything, because
 *   every Redis consumer falls back to process-local behaviour.
 * - providers (Jolpica, OpenF1, Open-Meteo) are best effort: one down makes it
 *   "degraded" (200), because pages fall back to their last good cache.
 */
export type CheckStatus = 'ok' | 'down' | 'not-configured';
export interface CheckResult { status: CheckStatus; latencyMs?: number }
export type ProviderName = 'jolpica' | 'openf1' | 'openmeteo';
export interface HealthBody {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  version: string | null;
  region: string | null;
  checks: { database: CheckResult; redis: CheckResult; providers: Record<ProviderName, CheckResult> };
}
export interface HealthDeps {
  env: Readonly<Record<string, string | undefined>>;
  database: () => Promise<void>;
  redis: () => Promise<void>;
  provider: (name: ProviderName) => Promise<void>;
  timeoutMs?: number;
}

const PROVIDERS: ProviderName[] = ['jolpica', 'openf1', 'openmeteo'];

async function probe(run: () => Promise<void>, timeoutMs: number): Promise<CheckResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch {
    return { status: 'down', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function runHealthChecks(deps: HealthDeps): Promise<{ httpStatus: number; body: HealthBody }> {
  const timeoutMs = deps.timeoutMs ?? 2_500;
  const env = deps.env;
  const production = env.VERCEL_ENV === 'production';
  const dbConfigured = Boolean(env.DATABASE_URL);
  const redisConfigured = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  const [database, redis, ...providerResults] = await Promise.all([
    dbConfigured ? probe(deps.database, timeoutMs) : Promise.resolve<CheckResult>({ status: 'not-configured' }),
    redisConfigured ? probe(deps.redis, timeoutMs) : Promise.resolve<CheckResult>({ status: 'not-configured' }),
    ...PROVIDERS.map((name) => probe(() => deps.provider(name), timeoutMs)),
  ]);
  const providers = Object.fromEntries(PROVIDERS.map((name, i) => [name, providerResults[i]!])) as Record<ProviderName, CheckResult>;
  const requiredDown = database!.status === 'down' || (production && database!.status === 'not-configured');
  const anyDegraded = Object.values(providers).some((check) => check.status !== 'ok') || database!.status !== 'ok' || redis!.status === 'down';
  const status: HealthBody['status'] = requiredDown ? 'down' : anyDegraded ? 'degraded' : 'ok';
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return {
    httpStatus: status === 'down' ? 503 : 200,
    body: {
      status,
      checkedAt: new Date().toISOString(),
      version: sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : null,
      region: env.VERCEL_REGION && /^[a-z0-9]{2,8}$/.test(env.VERCEL_REGION) ? env.VERCEL_REGION : null,
      checks: { database: database!, redis: redis!, providers },
    },
  };
}

/** Upstash REST PING; a 2xx with result "PONG" is healthy. */
export async function pingRedis(env: Readonly<Record<string, string | undefined>> = process.env, signal?: AbortSignal): Promise<void> {
  const url = new URL(env.UPSTASH_REDIS_REST_URL ?? '');
  if (url.protocol !== 'https:') throw new Error('invalid');
  const response = await guardedRedisFetch('health')(url.origin, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify(['PING']),
    cache: 'no-store',
    redirect: 'error',
    signal,
  });
  const body = (await response.json().catch(() => null)) as { result?: unknown } | null;
  if (!response.ok || body?.result !== 'PONG') throw new Error('unhealthy');
}

/** The smallest real request each provider answers; the local dev cache is honoured exactly as the clients do. */
export function providerProbeUrl(name: ProviderName, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (name === 'jolpica') return `${resolveProviderBase('JOLPICA_BASE_URL', 'https://api.jolpi.ca/ergast/f1', env, () => undefined).base}/seasons.json?limit=1`;
  if (name === 'openf1') return `${resolveProviderBase('OPENF1_BASE_URL', 'https://api.openf1.org/v1', env, () => undefined).base}/meetings?meeting_key=latest`;
  return 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m';
}

// One Redis PING per instance per 5 minutes at most (uptime monitors check every minute).
// PING still answers 200 on a spent Upstash quota, so an open breaker (a data command
// was refused) reports down without a call.
const REDIS_PROBE_TTL_MS = 5 * 60_000;
let redisProbe: { at: number; result: Promise<void> } | null = null;
export function cachedRedisProbe(env: Readonly<Record<string, string | undefined>> = process.env, now = Date.now()): Promise<void> {
  if (redisBreakerOpen()) return Promise.reject(new Error('unhealthy'));
  if (redisProbe && now - redisProbe.at < REDIS_PROBE_TTL_MS) return redisProbe.result;
  const result = pingRedis(env, AbortSignal.timeout(2_500));
  result.catch(() => undefined);
  redisProbe = { at: now, result };
  return result;
}
/** Test isolation: forget the cached Redis probe. */
export function forgetRedisProbe(): void { redisProbe = null; }

// Provider probes are shared per instance for 60 s so a burst of health checks
// never turns into a burst of upstream requests.
const PROVIDER_TTL_MS = 60_000;
const providerCache = new Map<ProviderName, { at: number; result: Promise<void> }>();

export function cachedProviderProbe(name: ProviderName, env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  const hit = providerCache.get(name);
  if (hit && Date.now() - hit.at < PROVIDER_TTL_MS) return hit.result;
  const result = (async () => {
    const response = await fetch(providerProbeUrl(name, env), {
      headers: { accept: 'application/json', 'user-agent': 'apex-f1-health/1.0' },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(2_500),
    });
    await response.body?.cancel().catch(() => undefined);
    // 429 means the provider is up and answering; treat it as reachable.
    if (!response.ok && response.status !== 429) throw new Error('unhealthy');
  })();
  result.catch(() => undefined);
  providerCache.set(name, { at: Date.now(), result });
  return result;
}
