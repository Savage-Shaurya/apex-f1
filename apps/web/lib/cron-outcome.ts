import { jolpica, mapRace, type FetchOpts, type UiRace } from '@apex/api-client/jolpica';
import { lastGoodRedisConfig } from '@apex/api-client/openf1';
import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import { guardedRedisFetch } from '../../../packages/api-client/src/redis-guard';
import { isProviderUnavailable, untrackedFetch } from '../../../packages/api-client/src/transport';
import { buildReport, logReport, type CronReport } from './cron-auth';

/**
 * Cron outcome contract (cron resilience, 2026-10-31; documented in DEPLOY.md).
 *
 * A scheduled job whose work could not be done only because an upstream
 * provider is unavailable (Jolpica overloaded on a race weekend: timeouts,
 * 429, 5xx, edge errors) answers
 *
 *   HTTP 503, Retry-After: 120
 *   { ok: false, route, retryable: true, reason: "provider-unavailable",
 *     provider, error, lastSuccessAt: ISO | null, ... }
 *
 * `lastSuccessAt` is when this route last returned an ok report (stored per
 * route, environment-scoped, in Upstash and in this process). The workflow
 * runner (scripts/invoke-cron.mjs) retries such a report and, if the outage
 * persists, ends green with a warning while lastSuccessAt is recent and red
 * once it is too old. Every other failure (our bug, auth/config, invalid data)
 * keeps its HTTP 500 and never carries `retryable`.
 */
export const PROVIDER_UNAVAILABLE = 'provider-unavailable' as const;
export const PROVIDER_UNAVAILABLE_RETRY_AFTER_S = 120;

/** Oldest validated calendar a cron job may run on while Jolpica is unavailable. */
export const CRON_CALENDAR_MAX_AGE_MS = 7 * 86_400_000;

export interface CronCalendar {
  races: UiRace[];
  /** 'provider' = read now (or the normal short cache); 'last-good' = an older validated copy during an outage. */
  source: 'provider' | 'last-good';
  storedAt: string | null;
}

/**
 * The current-season calendar for a cron job. It barely changes, so while
 * Jolpica is unavailable the last validated copy (this process, else the
 * shared Upstash copy) up to 7 days old is used and reported as such. Throws
 * when there is none; the caller classifies the error.
 */
export async function readCronCalendar(opts: FetchOpts): Promise<CronCalendar> {
  let servedAt: number | null = null;
  const races = (await jolpica.getSchedule('current', {
    ...opts,
    strict: true,
    staleFallback: { maxAgeMs: CRON_CALENDAR_MAX_AGE_MS, onServed: (storedAt) => { servedAt = storedAt; } },
  })).map(mapRace);
  if (!races.length) throw new Error('schedule returned no races');
  const storedAt = servedAt as number | null;
  return storedAt === null
    ? { races, source: 'provider', storedAt: null }
    : { races, source: 'last-good', storedAt: new Date(storedAt).toISOString() };
}

/** Report fields for a run that used an older calendar copy. */
export function calendarReport(calendar: CronCalendar): { degraded?: true; calendar: { source: CronCalendar['source']; storedAt?: string } } {
  return calendar.source === 'last-good'
    ? { degraded: true, calendar: { source: 'last-good', storedAt: calendar.storedAt! } }
    : { calendar: { source: 'provider' } };
}

/** The provider to name when every failure is an outage; null when any failure is ours. */
export function unavailableProvider(errors: readonly unknown[]): string | null {
  if (!errors.length || !errors.every(isProviderUnavailable)) return null;
  const provider = (errors[0] as { provider?: unknown }).provider;
  return typeof provider === 'string' && /^[a-z0-9-]{1,32}$/.test(provider) ? provider : 'provider';
}

/** Node network failures that mean "the other side is not reachable right now". */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
/**
 * PostgreSQL SQLSTATEs for an unreachable or overloaded server: connection
 * exceptions (08xxx), shutdown/starting up (57P01-57P03), too many
 * connections / insufficient resources (53xxx). Auth (28xxx), permissions,
 * missing tables and every other code are configuration or our bug.
 */
const DATABASE_OUTAGE_SQLSTATE = /^(?:08\d{3}|57P0[1-3]|53\d{3})$/;
const DATABASE_OUTAGE_MESSAGE = /connection terminated unexpectedly|timeout exceeded when trying to connect|connection timeout|server closed the connection unexpectedly/i;

/** True when the job database could not be reached (Supabase down, pooler overloaded), never for auth or SQL errors. */
export function isDatabaseUnavailable(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const record = current as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
    if (typeof record.code === 'string') {
      if (NETWORK_CODES.has(record.code) || DATABASE_OUTAGE_SQLSTATE.test(record.code)) return true;
      if (/^(?:28|42)/.test(record.code)) return false;
    }
    if (typeof record.message === 'string' && DATABASE_OUTAGE_MESSAGE.test(record.message)) return true;
    current = record.cause ?? (Array.isArray(record.errors) ? record.errors[0] : undefined);
  }
  return false;
}

export type ProviderUnavailableReport = CronReport & {
  retryable: true;
  reason: typeof PROVIDER_UNAVAILABLE;
  provider: string;
  lastSuccessAt?: string | null;
  [extra: string]: unknown;
};

/** 503 + machine-readable report; lastSuccessAt is stamped by runLeasedCron (finalizeCronResponse). */
export function providerUnavailableResponse(
  start: number,
  input: { route: string; provider: string; error: string; results?: Record<string, unknown>; extra?: Record<string, unknown> },
): Response {
  const report: ProviderUnavailableReport = {
    ...buildReport(start, { ok: false, route: input.route, error: input.error, ...(input.results ? { results: input.results } : {}) }),
    retryable: true,
    reason: PROVIDER_UNAVAILABLE,
    provider: input.provider,
    ...input.extra,
  };
  logReport(report);
  return Response.json(report, {
    status: 503,
    headers: { 'cache-control': 'no-store', 'retry-after': String(PROVIDER_UNAVAILABLE_RETRY_AFTER_S) },
  });
}

/**
 * 'success' = a full run (lastSuccessAt, the staleness alarm's clock);
 * 'degraded' = an ok run that used a fallback (last-good calendar, some sources
 * down). A degraded run never moves lastSuccessAt (review F-02).
 */
export type CronStatusKind = 'success' | 'degraded';
export interface CronStatusStore {
  read(route: string, kind?: CronStatusKind): Promise<number | null>;
  write(route: string, at: number, kind?: CronStatusKind): Promise<void>;
}

const STATUS_TTL_S = 30 * 86_400;
export function cronLastSuccessKey(route: string, env: Readonly<Record<string, string | undefined>> = process.env, kind: CronStatusKind = 'success'): string {
  if (!/^[a-z0-9-]{1,40}$/.test(route)) throw new Error('Invalid cron route.');
  return scopedRedisKey(`apex:cron:v1:last-${kind}:${route}`, env);
}

const processGlobals = globalThis as typeof globalThis & { __apexCronLastSuccess?: Map<string, number> };
const memory = () => (processGlobals.__apexCronLastSuccess ??= new Map());
/** Test isolation only: forget this process's remembered runs. */
export function forgetCronSuccessesInProcess(): void { memory().clear(); }

/**
 * Last full / degraded run per route: this process's memory plus Upstash
 * (shared by every instance, environment-scoped, 30 days) when configured.
 * Redis calls are bounded (2 s); a failed read counts as unknown, never as recent.
 */
export function defaultCronStatusStore(env: Readonly<Record<string, string | undefined>> = process.env, fetchImpl: typeof fetch = untrackedFetch()): CronStatusStore {
  const redis = lastGoodRedisConfig(env);
  // Guarded (redis-guard.ts): an open breaker answers at once; a failed read is "unknown".
  const guarded = guardedRedisFetch('cron-status', fetchImpl);
  const call = async (command: string[]): Promise<unknown> => {
    const response = await guarded(redis!.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis!.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error('cron status store unavailable');
    return ((await response.json()) as { result?: unknown }).result;
  };
  return {
    async read(route, kind = 'success') {
      const local = memory().get(`${kind}:${route}`) ?? null;
      if (!redis) return local;
      let shared: number | null = null;
      try {
        const value = await call(['GET', cronLastSuccessKey(route, env, kind)]);
        shared = typeof value === 'string' && /^\d{13}$/.test(value) ? Number(value) : null;
      } catch { shared = null; }
      return Math.max(local ?? 0, shared ?? 0) || null;
    },
    async write(route, at, kind = 'success') {
      const key = `${kind}:${route}`;
      memory().set(key, Math.max(memory().get(key) ?? 0, at));
      if (redis) await call(['SET', cronLastSuccessKey(route, env, kind), String(at), 'EX', String(STATUS_TTL_S)]);
    },
  };
}

const iso = (at: number | null) => (at && Number.isFinite(at) ? new Date(at).toISOString() : null);
function restamp(response: Response, report: Record<string, unknown>): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return Response.json(report, { status: response.status, headers });
}

/**
 * Applied to every report a cron task returns. A full ok report records a
 * success. A degraded ok report records only lastDegradedAt and carries the
 * last FULL success, so the runner can go red once that is too old even while
 * fallbacks keep the job "ok" (review F-02). A provider-unavailable report gets
 * lastSuccessAt and lastDegradedAt. Bookkeeping failures never change the outcome.
 */
export async function finalizeCronResponse(route: string, response: Response, store: CronStatusStore | null): Promise<Response> {
  if (!store || (response.status !== 200 && response.status !== 503)) return response;
  let body: unknown;
  try { body = await response.clone().json(); } catch { return response; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response;
  const report = body as Record<string, unknown>;
  if (report.route !== route) return response;
  if (response.status === 200 && report.ok === true) {
    if (report.degraded !== true) {
      await store.write(route, Date.now(), 'success').catch(() => undefined);
      return response;
    }
    await store.write(route, Date.now(), 'degraded').catch(() => undefined);
    const at = await store.read(route, 'success').catch(() => null);
    return restamp(response, { ...report, lastSuccessAt: iso(at) });
  }
  if (response.status === 503 && report.reason === PROVIDER_UNAVAILABLE && report.retryable === true) {
    const [success, degraded] = await Promise.all([store.read(route, 'success').catch(() => null), store.read(route, 'degraded').catch(() => null)]);
    return restamp(response, { ...report, lastSuccessAt: iso(success), lastDegradedAt: iso(degraded) });
  }
  return response;
}
