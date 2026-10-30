/**
 * Upstash Redis is optional (incident 2026-10-31).
 *
 * The free Upstash plan answers every data command with HTTP 400
 * `ERR max requests limit exceeded` once its monthly quota is spent (PING
 * still answers 200). That reply used to fail every Jolpica read at the shared
 * admission step, so crons answered 500/503 and the production build failed.
 *
 * Every Upstash REST call in the product now goes through `guardedRedisFetch`:
 *   - a quota reply (400 "limit exceeded", 429) or an auth failure (401/403)
 *     opens this process's breaker at once for REDIS_BREAKER_MS (no hammering);
 *   - a transient failure (5xx, 408, timeout/abort, dropped connection, a body
 *     that is not Upstash JSON) opens it after REDIS_TRANSIENT_TRIP_AFTER
 *     failures in a row, for a shorter window;
 *   - while it is open, calls fail at once with RedisUnavailableError and
 *     never touch the network; after the window one call probes again;
 *   - each trip logs one structured warning (`redis.breaker.open`) carrying
 *     only the kind, status, consumer and window: never a URL, key or token.
 * Callers catch RedisUnavailableError and degrade to process-local behaviour
 * (local admission/pacing, process caches, in-memory limiter). It is never a
 * provider outage (classifyProviderFailure → 'redis-unavailable').
 *
 * One breaker per fetch implementation: in production every consumer uses the
 * platform fetch, so they share one breaker per process; a test's fake fetch
 * gets its own.
 */
import { isFrameworkControlError, untrackedFetch } from './transport';

export type RedisFailureKind = 'redis-quota' | 'redis-auth' | 'redis-unavailable';

export class RedisUnavailableError extends Error {
  constructor(
    readonly kind: RedisFailureKind,
    readonly consumer: string,
    readonly status?: number,
  ) {
    super(`${consumer}: ${kind}${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'RedisUnavailableError';
  }
}

export function isRedisUnavailable(error: unknown): error is RedisUnavailableError {
  return error instanceof RedisUnavailableError || (error instanceof Error && error.name === 'RedisUnavailableError');
}
/** The Redis failure behind an error (itself or its `cause`), or null. */
export function redisFailureOf(error: unknown): RedisUnavailableError | null {
  if (isRedisUnavailable(error)) return error;
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  return isRedisUnavailable(cause) ? cause : null;
}

/** How long the breaker stays open after each kind of failure. */
export const REDIS_BREAKER_MS: Readonly<Record<RedisFailureKind, number>> = {
  // A spent monthly quota does not come back within minutes; probe every 15 min.
  'redis-quota': 15 * 60_000,
  'redis-auth': 15 * 60_000,
  'redis-unavailable': 30_000,
};
/** Transient failures in a row before the breaker opens (quota/auth open at once). */
export const REDIS_TRANSIENT_TRIP_AFTER = 2;
/** Upstash replies larger than this are refused (largest legitimate value: OpenF1 snapshots, 2 MB). */
const MAX_REPLY_BYTES = 4_200_000;
const QUOTA_BODY = /limit exceeded|max requests|quota/i;

interface Breaker { openUntil: number; kind: RedisFailureKind | null; transient: number }
interface Counter { commands: number; calls: number; byConsumer: Map<string, number> }
const globals = globalThis as typeof globalThis & {
  __apexRedisBreakers?: WeakMap<object, Breaker>;
  __apexRedisCounter?: Counter;
  __apexRedisClock?: () => number;
};
const breakers = () => (globals.__apexRedisBreakers ??= new WeakMap());
const counter = () => (globals.__apexRedisCounter ??= { commands: 0, calls: 0, byConsumer: new Map() });
const now = () => (globals.__apexRedisClock ?? Date.now)();

function breakerFor(impl: typeof fetch): Breaker {
  let state = breakers().get(impl);
  if (!state) { state = { openUntil: 0, kind: null, transient: 0 }; breakers().set(impl, state); }
  return state;
}

/** Test isolation and operator tooling: forget every breaker (as after a restart). */
export function resetRedisBreakers(): void { globals.__apexRedisBreakers = new WeakMap(); }
/** Tests only: drive the breaker clock. */
export function setRedisBreakerClock(clock: (() => number) | null): void { globals.__apexRedisClock = clock ?? undefined; }

/** True while this process's breaker for that fetch (default: the platform fetch) is open. */
export function redisBreakerOpen(impl?: typeof fetch): boolean {
  return breakerFor(impl ?? untrackedFetch()).openUntil > now();
}
/** The kind that opened the breaker, or null while it is closed. */
export function redisBreakerState(impl?: typeof fetch): { open: boolean; kind: RedisFailureKind | null; retryInMs: number } {
  const state = breakerFor(impl ?? untrackedFetch());
  const remaining = state.openUntil - now();
  return remaining > 0 ? { open: true, kind: state.kind, retryInMs: remaining } : { open: false, kind: null, retryInMs: 0 };
}

/** Commands sent to Upstash by this process (pipelines count each command), per consumer. */
export function redisCommandStats(): { commands: number; calls: number; byConsumer: Record<string, number> } {
  const c = counter();
  return { commands: c.commands, calls: c.calls, byConsumer: Object.fromEntries(c.byConsumer) };
}
export function resetRedisCommandStats(): void { globals.__apexRedisCounter = { commands: 0, calls: 0, byConsumer: new Map() }; }

function trip(state: Breaker, kind: RedisFailureKind, consumer: string, status?: number): void {
  const wasOpen = state.openUntil > now();
  state.kind = kind;
  state.openUntil = now() + REDIS_BREAKER_MS[kind];
  state.transient = 0;
  if (!wasOpen) {
    // One line per trip; no URL, key, body or token ever reaches the log.
    console.warn(JSON.stringify({ event: 'redis.breaker.open', kind, consumer, status: status ?? null, retryInMs: REDIS_BREAKER_MS[kind] }));
  }
}

function transientFailure(state: Breaker, consumer: string, status?: number): RedisUnavailableError {
  state.transient += 1;
  if (state.transient >= REDIS_TRANSIENT_TRIP_AFTER) trip(state, 'redis-unavailable', consumer, status);
  return new RedisUnavailableError('redis-unavailable', consumer, status);
}

function commandCount(body: unknown): number {
  if (typeof body !== 'string') return 1;
  try {
    const parsed = JSON.parse(body) as unknown;
    return Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed.length : 1;
  } catch { return 1; }
}

async function readCapped(response: Response, maxBytes: number, signal?: AbortSignal | null): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  // The caller's deadline also cancels a body that never finishes.
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function upstashShaped(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed.every((entry) => entry && typeof entry === 'object' && ('result' in entry || 'error' in entry));
    return Boolean(parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed));
  } catch { return false; }
}

/**
 * Wrap a fetch used for Upstash REST calls. The returned fetch throws
 * RedisUnavailableError for an open breaker, a quota/auth reply and a
 * transient failure; any other reply (2xx, or a 4xx command error from
 * Upstash such as a script error, which is our bug) is handed back unchanged.
 */
export function guardedRedisFetch(consumer: string, base?: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const impl = base ?? untrackedFetch();
    const state = breakerFor(impl);
    if (state.openUntil > now()) throw new RedisUnavailableError(state.kind ?? 'redis-unavailable', consumer);
    const c = counter();
    const sent = commandCount(init?.body);
    c.calls += 1;
    c.commands += sent;
    c.byConsumer.set(consumer, (c.byConsumer.get(consumer) ?? 0) + sent);
    let response: Response;
    let text: string | null;
    try {
      response = await impl(input, init);
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => undefined);
        trip(state, 'redis-auth', consumer, response.status);
        throw new RedisUnavailableError('redis-auth', consumer, response.status);
      }
      if (response.status === 429) {
        void response.body?.cancel().catch(() => undefined);
        trip(state, 'redis-quota', consumer, 429);
        throw new RedisUnavailableError('redis-quota', consumer, 429);
      }
      if (response.status >= 500 || response.status === 408) {
        void response.body?.cancel().catch(() => undefined);
        throw transientFailure(state, consumer, response.status);
      }
      text = await readCapped(response, response.ok ? MAX_REPLY_BYTES : 4_096, init?.signal);
    } catch (error) {
      if (isRedisUnavailable(error) || isFrameworkControlError(error)) throw error;
      // Timeout/abort, refused or reset connection, a stalled body: transient.
      throw transientFailure(state, consumer);
    }
    if (text === null || !upstashShaped(text)) {
      throw transientFailure(state, consumer, response.ok ? undefined : response.status);
    }
    if (!response.ok && QUOTA_BODY.test(text)) {
      trip(state, 'redis-quota', consumer, response.status);
      throw new RedisUnavailableError('redis-quota', consumer, response.status);
    }
    state.transient = 0;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  }) as typeof fetch;
}
