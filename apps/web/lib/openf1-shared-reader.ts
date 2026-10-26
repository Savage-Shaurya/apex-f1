import { createHash, randomUUID } from 'node:crypto';
import { openf1, openF1FailureReason, defaultOpenF1LastGoodStore, isOpenF1LockedOut, OpenF1LiveSessionLockout, type FetchOpts, type OpenF1FailureReason, type OpenF1LastGoodStore, type OpenF1Provenance } from '@apex/api-client/openf1';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { liveStoreConfig } from './live-shared-store';
import { createUpstashOpenF1ReadStore, MAX_OPENF1_CACHE_BYTES, type OpenF1ReadStore } from './openf1-read-store';
import { createLiveSourceSnapshot, liveSourceQuery, liveSourceFreshnessMs, liveSourceRefreshAfterMs, liveSourceSnapshotRows, validateLiveSourceSnapshot, type LiveSourceEndpoint, type LiveSourceSnapshot } from './live-source-snapshot';

const PAGE_BUDGET_MS = 20_000;
/**
 * Queue waits (shared lock followers, busy admission) stop this long before
 * the page budget ends, so a stored last-good copy can still be read (R3-BE-1).
 */
export const LAST_GOOD_RESERVE_MS = 1_500;
/** Queue/page-budget exhaustion is a timeout: fallback-eligible, unlike 'incomplete'. */
const budgetExhausted = () => new ProviderError('openf1', 'timeout');
const fields: Record<string, string[]> = {
  sessions: ['session_key', 'meeting_key', 'session_type', 'session_name', 'date_start', 'date_end', 'circuit_key', 'circuit_short_name', 'country_code', 'country_name', 'location', 'gmt_offset', 'year', 'is_cancelled'],
  drivers: ['session_key', 'meeting_key', 'driver_number', 'full_name', 'name_acronym', 'team_name', 'team_colour', 'country_code', 'headshot_url', 'first_name', 'last_name', 'broadcast_name'],
  position: ['session_key', 'meeting_key', 'driver_number', 'date', 'position'],
  intervals: ['session_key', 'meeting_key', 'driver_number', 'date', 'interval', 'gap_to_leader'],
  stints: ['session_key', 'meeting_key', 'driver_number', 'stint_number', 'compound', 'lap_start', 'lap_end', 'tyre_age_at_start'],
  weather: ['session_key', 'meeting_key', 'date', 'air_temperature', 'track_temperature', 'humidity', 'pressure', 'wind_speed', 'wind_direction', 'rainfall'],
  race_control: ['session_key', 'meeting_key', 'date', 'category', 'message', 'flag', 'scope', 'driver_number', 'lap_number', 'sector'],
  laps: ['session_key', 'meeting_key', 'driver_number', 'date_start', 'lap_number', 'lap_duration', 'duration_sector_1', 'duration_sector_2', 'duration_sector_3', 'is_pit_out_lap', 'i1_speed', 'i2_speed', 'st_speed', 'segments_sector_1', 'segments_sector_2', 'segments_sector_3'],
  location: ['session_key', 'meeting_key', 'driver_number', 'date', 'x', 'y', 'z'],
};
const ttl: Record<string, number> = { sessions: 30_000, drivers: 300_000, position: 30_000, intervals: 30_000, stints: 60_000, weather: 60_000, race_control: 30_000, laps: 60_000, location: 10_000 };
const unavailable = () => new ProviderError('openf1', 'incomplete');
function canonicalDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))
    || new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)) throw new ProviderError('openf1', 'invalid-input');
  return new Date(value).toISOString().slice(0, 19) + 'Z';
}
/** Only declared response fields are durable. No provider tokens/opaque payloads. */
function cacheRows(endpoint: string, value: unknown, now: number): unknown[] {
  let rows = value === null ? [] : Array.isArray(value) ? value : [value];
  if (endpoint !== 'sessions') for (const row of rows) {
    const record = row as Record<string, unknown>;
    for (const field of ['date', 'date_start']) if (typeof record?.[field] === 'string' && Date.parse(record[field] as string) > now + 5000) throw new ProviderError('openf1', 'invalid-response');
  }
  if (endpoint === 'position') {
    // This explicit public reader serves latest-per-driver snapshots, not the
    // full history API. Validate the complete source first, then retain each
    // newest original record so race length cannot grow the durable cache.
    const latest = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      const item = row as Record<string, unknown>;
      if (!item || typeof item.driver_number !== 'number' || typeof item.date !== 'string') throw unavailable();
      const previous = latest.get(item.driver_number);
      if (!previous || Date.parse(item.date) > Date.parse(previous.date as string)) latest.set(item.driver_number, item);
    }
    rows = [...latest.values()];
  }
  if (rows.length > 10000 || !fields[endpoint]) throw unavailable();
  const safe = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
    const record = row as Record<string, unknown>; const result: Record<string, unknown> = {};
    for (const field of fields[endpoint]!) {
      const entry = record[field];
      if (entry === undefined) continue;
      if (entry !== null && typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
        // Segment arrays are not consumed by the public map; omit them rather than
        // persist an arbitrary nested provider payload.
        if (field.startsWith('segments_sector_')) continue;
        throw unavailable();
      }
      if ((typeof entry === 'string' && entry.length > 4000) || (typeof entry === 'number' && !Number.isFinite(entry))) throw unavailable();
      result[field] = entry;
    }
    return result;
  });
  if (new TextEncoder().encode(JSON.stringify(safe)).byteLength > MAX_OPENF1_CACHE_BYTES) throw unavailable();
  return safe;
}
export interface ReaderDependencies {
  store: OpenF1ReadStore | null;
  source?: typeof openf1;
  fetch?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  ownerId?: () => string;
  /** Whether a live-session lockout is remembered (defaults to the process memo). */
  lockedOut?: () => boolean;
  /** The caller owns this work's lifetime. Production uses Next after; tests
   * and workers must retain and await the callback, including its cleanup. */
  scheduleRefresh?: (job: () => Promise<void>) => void;
  /** Last-good snapshot store (defaults to the process/Redis store). null disables it. */
  lastGoodStore?: OpenF1LastGoodStore | null;
  /**
   * Without a shared store, read OpenF1 directly (with last-good fallback)
   * instead of failing closed. Only enabled outside production, where there
   * is one local server and the dev provider cache enforces OpenF1's limits.
   */
  direct?: boolean;
}

/**
 * How current the OpenF1 data on one page is. `stale` is true when at least
 * one read was answered from a stored earlier response because OpenF1 refused
 * or failed (for example while a session is live). `asOf` is then the oldest
 * such fetch time, so the page can say "as of HH:MM UTC" truthfully.
 */
export interface OpenF1PageFreshness {
  stale: boolean;
  asOf: number | null;
  reason: OpenF1FailureReason | null;
}

export function summariseOpenF1Freshness(ledger: readonly OpenF1Provenance[]): OpenF1PageFreshness {
  const stored = ledger.filter((entry) => entry.source === 'last-good');
  if (!stored.length) return { stale: false, asOf: null, reason: null };
  const oldest = stored.reduce((a, b) => (b.asOf < a.asOf ? b : a));
  const lockout = stored.find((entry) => entry.reason === 'live-session-lockout');
  return { stale: true, asOf: oldest.asOf, reason: lockout?.reason ?? oldest.reason ?? null };
}
const sleep = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(unavailable()); return; }
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
  const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(unavailable()); };
  const timer = setTimeout(finish, milliseconds); signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});

/**
 * Explicit server caller contract: one reader per page/request, one 20-second
 * whole-page budget. Admission precedes the separate provider deadline. Every
 * cache hit is revalidated by the real strict client; provider dates are retained.
 * The process holds no durable cache. The shared cache/locks and live hub use
 * the same account quota and dispatch guard; no Next fetch cache bypasses admission.
 */
export function createOpenF1PageReader(dependencies: ReaderDependencies) {
  const now = dependencies.now ?? Date.now, wait = dependencies.wait ?? sleep;
  const lockedOut = dependencies.lockedOut ?? (() => isOpenF1LockedOut());
  const source = dependencies.source ?? openf1;
  const observedAt = now();
  const deadline = observedAt + PAGE_BUDGET_MS;
  const scheduled = new Set<string>();
  const sourceCapable = () => !!dependencies.store?.readSource && !!dependencies.store.publishSource;
  const ledger: OpenF1Provenance[] = [];
  const record = (provenance: OpenF1Provenance) => { ledger.push(provenance); };
  const snapshotStore = () => (dependencies.lastGoodStore !== undefined ? dependencies.lastGoodStore : defaultOpenF1LastGoodStore());
  /** Serve the last good response of exactly this query after a provider failure. Never republished as fresh. */
  const lastGood = async <T>(invoke: (options: FetchOpts) => Promise<T>, options: FetchOpts, error: unknown): Promise<{ value: T } | null> => {
    if (!openF1FailureReason(error)) return null;
    const store = snapshotStore();
    if (!store) return null;
    try {
      const value = await invoke({ ...options, strict: true, revalidate: 0, signal: undefined, fetchImpl: undefined, lastGood: 'only', lastGoodStore: store, onProvenance: (provenance) => record({ ...provenance, reason: openF1FailureReason(error) ?? undefined }) });
      return { value };
    } catch { return null; }
  };
  /**
   * The page budget running out mid-read ('incomplete' at the deadline) is a
   * timeout for last-good purposes; a caller's own cancellation is not.
   */
  const fallbackReason = (failure: ProviderError, options: FetchOpts, budgetEnd: number): ProviderError =>
    failure.code === 'incomplete' && !options.signal?.aborted && now() >= budgetEnd - LAST_GOOD_RESERVE_MS ? budgetExhausted() : failure;
  /** Development without a shared store: one direct, bounded read with last-good fallback. */
  const direct = <T>(invoke: (options: FetchOpts) => Promise<T>, options: FetchOpts): Promise<T> => {
    const remaining = deadline - now();
    if (remaining <= 0 || options.signal?.aborted) return Promise.reject(unavailable());
    return invoke({ ...options, strict: true, fetchImpl: dependencies.fetch, lastGood: 'fallback', ...(dependencies.lastGoodStore !== undefined ? { lastGoodStore: dependencies.lastGoodStore } : {}), onProvenance: record, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 6000, 6000, remaining)) });
  };
  const cleanupSource = async (store: OpenF1ReadStore, query: string, owner: string, fence: number | null, admitted: boolean) => {
    const cleanup = new AbortController().signal;
    // Both transports are bounded. Awaiting them keeps all background work in
    // the durable callback rather than leaving cleanup outside its lifetime.
    await Promise.allSettled([...(admitted ? [store.complete(owner, cleanup)] : []), ...(fence !== null ? [store.release(query, owner, fence, cleanup)] : [])]);
  };
  const runSource = async <T>(endpoint: LiveSourceEndpoint, key: number | 'latest', invoke: (options: FetchOpts) => Promise<T>, options: FetchOpts = {}, refresh?: { owner: string; fence: number; claimedAt: number; budgetDeadline?: number }): Promise<T> => {
    if (!sourceCapable() && !dependencies.store && dependencies.direct) return direct(invoke, options);
    if (!sourceCapable()) throw new ProviderError('openf1', 'configuration');
    if ((key !== 'latest' && (!Number.isSafeInteger(key) || key <= 0)) || (key === 'latest' && endpoint !== 'sessions') || options.dateGte || options.dateLte) throw new ProviderError('openf1', 'invalid-input');
    const store = dependencies.store!;
    const identity = { endpoint, sessionKey: key };
    const query = liveSourceQuery(endpoint, key);
    const owner = refresh?.owner ?? dependencies.ownerId?.() ?? randomUUID();
    // A response callback starts a fresh absolute budget. It does not inherit
    // a page deadline that may already be exhausted when Next runs after.
    const sourceDeadline = refresh ? refresh.budgetDeadline ?? now() + PAGE_BUDGET_MS : deadline;
    const remaining = sourceDeadline - now();
    if (remaining <= 0 || options.signal?.aborted) {
      if (refresh) await cleanupSource(store, query, owner, refresh.fence, false);
      throw unavailable();
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, remaining);
    const signal = controller.signal;
    let fence: number | null = refresh?.fence ?? null, admitted = false;
    const check = () => {
      if (signal.aborted || now() >= sourceDeadline || (refresh && now() - refresh.claimedAt >= 25_000)) throw unavailable();
    };
    const queueDeadline = sourceDeadline - LAST_GOOD_RESERVE_MS;
    const queueCheck = () => { check(); if (now() >= queueDeadline) throw budgetExhausted(); };
    const providerOptions = (acquiring = false): FetchOpts => ({ ...options, ...(acquiring && dependencies.lastGoodStore !== undefined ? { lastGoodStore: dependencies.lastGoodStore } : {}), strict: true, revalidate: 0, signal, fetchImpl: dependencies.fetch, maxBytes: 8_000_000, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 6000, 6000, sourceDeadline - now(), refresh ? refresh.claimedAt + 25_000 - now() : Infinity)) });
    const decode = async (snapshot: LiveSourceSnapshot) => {
      const rows = liveSourceSnapshotRows(snapshot);
      const result = await invoke({ ...providerOptions(), maxBytes: MAX_OPENF1_CACHE_BYTES, fetchImpl: async () => Response.json(rows) });
      check(); return result;
    };
    const read = async () => {
      check(); const value = await store.readSource!(query, signal); check();
      if (!value) return null;
      const snapshot = await validateLiveSourceSnapshot(value, identity, now(), signal); check();
      return { snapshot, result: await decode(snapshot) };
    };
    const schedule = async (snapshot: LiveSourceSnapshot): Promise<{ result: T } | null> => {
      if (refresh || scheduled.has(query) || !['sessions', 'drivers', 'stints', 'weather'].includes(endpoint)
        || now() - snapshot.acquisitionStartedAt < liveSourceRefreshAfterMs(endpoint)) return null;
      check(); const refreshOwner = dependencies.ownerId?.() ?? randomUUID();
      const claim = await store.claim(query, refreshOwner, signal);
      // Record successful ownership before cancellation can reject the reply.
      if (!claim.owner) { check(); return null; }
      const claimedAt = now();
      try {
        check();
        scheduled.add(query);
        if (!dependencies.scheduleRefresh) {
          // Other callers have no after-response lifetime. Their refresh is
          // awaited within the original whole-page budget instead.
          return { result: await runSource(endpoint, key, invoke, options, { owner: refreshOwner, fence: claim.fence, claimedAt, budgetDeadline: sourceDeadline }) };
        }
        dependencies.scheduleRefresh(() => runSource(endpoint, key, invoke, options, { owner: refreshOwner, fence: claim.fence, claimedAt }).then(() => {}));
        return null;
      } catch (error) {
        scheduled.delete(query);
        await cleanupSource(store, query, refreshOwner, claim.fence, false);
        throw error;
      }
    };
    try {
      let followerDelay = 150;
      for (;;) {
        const cached = await read();
        if (cached && (!refresh || now() - cached.snapshot.acquisitionStartedAt < liveSourceRefreshAfterMs(endpoint))) {
          const refreshed = await schedule(cached.snapshot); check(); return refreshed ? refreshed.result : cached.result;
        }
        if (refresh) break;
        // A remembered live-session refusal makes the read doomed: do not spend a lock or admission on it.
        if (lockedOut()) throw new OpenF1LiveSessionLockout();
        const lock = await store.claim(query, owner, signal);
        if (lock.owner) fence = lock.fence;
        check();
        if (lock.owner) break;
        await wait(Math.min(followerDelay, Math.max(1, lock.retryMs), Math.max(1, queueDeadline - now())), signal); queueCheck();
        followerDelay = Math.min(1000, followerDelay * 2);
      }
      if (!refresh) {
        const raced = await read();
        if (raced) { const refreshed = await schedule(raced.snapshot); check(); return refreshed ? refreshed.result : raced.result; }
      }
      for (;;) {
        queueCheck(); const admission = await store.admit(owner, signal);
        if (admission.retryMs === 0) admitted = true;
        check();
        if (admission.retryMs === 0) break;
        if (!admission.busy && admission.retryMs >= queueDeadline - now()) throw new ProviderError('openf1', 'rate-limit');
        await wait(Math.min(admission.retryMs, 1000, Math.max(1, queueDeadline - now())), signal);
      }
      check(); const acquisitionStartedAt = now();
      const result = await invoke(providerOptions(true)); check();
      const acquisitionCompletedAt = now();
      const rows = result === null ? [] : Array.isArray(result) ? result : [result];
      const snapshot = await createLiveSourceSnapshot(identity, rows, { acquisitionStartedAt, acquisitionCompletedAt, coverageLower: null, coverageUpper: null }, now(), signal); check();
      const cacheLifetime = Math.floor(liveSourceFreshnessMs(endpoint) - (now() - acquisitionStartedAt));
      if (cacheLifetime < 1000) throw unavailable();
      const saved = await store.publishSource!(query, owner, fence!, snapshot, cacheLifetime, signal); check();
      if (!saved) throw unavailable();
      const verified = await validateLiveSourceSnapshot(saved, identity, now(), signal); check();
      return await decode(verified);
    } catch (error) {
      const failure = error instanceof ProviderError ? error : unavailable();
      if (!refresh) {
        const stored = await lastGood(invoke, options, fallbackReason(failure, options, sourceDeadline));
        if (stored) return stored.value;
      }
      throw failure;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort();
      await cleanupSource(store, query, owner, fence, admitted);
    }
  };
  const run = async <T>(endpoint: string, params: Record<string, string | number>, invoke: (options: FetchOpts) => Promise<T>, options: FetchOpts = {}): Promise<T> => {
    if (!dependencies.store && dependencies.direct) return direct(invoke, options);
    if (!dependencies.store) throw new ProviderError('openf1', 'configuration');
    const store = dependencies.store;
    for (const value of Object.values(params)) if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new ProviderError('openf1', 'invalid-input');
    const canonical = { ...options, dateGte: options.dateGte ? canonicalDate(options.dateGte) : undefined, dateLte: options.dateLte ? canonicalDate(options.dateLte) : undefined };
    if (canonical.dateGte && canonical.dateLte && Date.parse(canonical.dateGte) >= Date.parse(canonical.dateLte)) throw new ProviderError('openf1', 'invalid-input');
    const query = createHash('sha256').update(JSON.stringify([endpoint, Object.entries(params).sort(), canonical.dateGte ?? null, canonical.dateLte ?? null])).digest('hex');
    const owner = dependencies.ownerId?.() ?? randomUUID();
    const remaining = deadline - now(); if (remaining <= 0 || options.signal?.aborted) throw unavailable();
    const controller = new AbortController(); const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(abort, remaining);
    const signal = controller.signal;
    let fence: number | null = null, admitted = false;
    const check = () => { if (signal.aborted || now() >= deadline) throw unavailable(); };
    const queueDeadline = deadline - LAST_GOOD_RESERVE_MS;
    const queueCheck = () => { check(); if (now() >= queueDeadline) throw budgetExhausted(); };
    const providerOptions = (): FetchOpts => ({ ...canonical, strict: true, revalidate: 0, signal, fetchImpl: dependencies.fetch, ...(dependencies.lastGoodStore !== undefined ? { lastGoodStore: dependencies.lastGoodStore } : {}), maxBytes: 8_000_000, timeoutMs: Math.max(1, Math.min(options.timeoutMs ?? 6000, 6000, deadline - now())) });
    const checkedCache = async () => {
      check(); const cached = await store.read(query, signal); check();
      if (!cached) return null;
      const age = now() - cached.writtenAt;
      // A clearly future-dated entry is corrupt. One past its TTL by this
      // server's clock (a few ms of skew against Redis) is only a miss (R3-BE-5).
      if (age < -5000) throw unavailable();
      if (age > ttl[endpoint]!) return null;
      if (new TextEncoder().encode(JSON.stringify(cached.rows)).byteLength > MAX_OPENF1_CACHE_BYTES) throw unavailable();
      // Validate every cached record before any snapshot compaction can hide a
      // foreign or malformed older record behind a newer valid one.
      const entire = await invoke({ ...providerOptions(), maxBytes: MAX_OPENF1_CACHE_BYTES, fetchImpl: async () => Response.json(cached.rows) });
      check();
      const result = await invoke({ ...providerOptions(), maxBytes: MAX_OPENF1_CACHE_BYTES, fetchImpl: async () => Response.json(cacheRows(endpoint, entire, now())) });
      check(); return { result };
    };
    try {
      let followerDelay = 150;
      for (;;) {
        const cached = await checkedCache(); if (cached) return cached.result;
        // A remembered live-session refusal makes the read doomed: do not spend a lock or admission on it.
        if (lockedOut()) throw new OpenF1LiveSessionLockout();
        const lock = await store.claim(query, owner, signal);
        if (lock.owner) fence = lock.fence;
        check();
        if (lock.owner) break;
        // Followers never consume provider admission. Increase their bounded
        // polling interval while an owner works so concurrent cold visitors do
        // not repeatedly saturate the shared Redis command queue. A published
        // snapshot is noticed within one second; cancellation stays immediate.
        await wait(Math.min(followerDelay, Math.max(1, lock.retryMs), Math.max(1, queueDeadline - now())), signal); queueCheck();
        followerDelay = Math.min(1000, followerDelay * 2);
      }
      const raced = await checkedCache(); if (raced) return raced.result;
      for (;;) {
        queueCheck(); const admission = await store.admit(owner, signal);
        if (admission.retryMs === 0) admitted = true;
        check();
        if (admission.retryMs === 0) break;
        if (!admission.busy && admission.retryMs >= queueDeadline - now()) throw new ProviderError('openf1', 'rate-limit');
        await wait(Math.min(admission.retryMs, 1000, Math.max(1, queueDeadline - now())), signal);
      }
      check(); const result = await invoke(providerOptions()); check();
      const rows = cacheRows(endpoint, result, now());
      // Cache sanitization itself must still satisfy the endpoint schema/identity.
      const verified = await invoke({ ...providerOptions(), fetchImpl: async () => Response.json(rows) }); check();
      const saved = await store.publish(query, owner, fence!, rows, ttl[endpoint]!, signal); check();
      if (!saved) throw unavailable();
      return verified;
    } catch (error) {
      const failure = error instanceof ProviderError ? error : unavailable();
      const stored = await lastGood(invoke, canonical, fallbackReason(failure, options, deadline));
      if (stored) return stored.value;
      throw failure;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort); controller.abort();
      // A canceled caller cannot leave permanent locks or manufacture quota refunds.
      // Cleanup uses its own bounded transport; it never restores consumed starts.
      const cleanup = new AbortController().signal;
      void Promise.allSettled([...(admitted ? [store.complete(owner, cleanup)] : []), ...(fence !== null ? [store.release(query, owner, fence, cleanup)] : [])]);
    }
  };
  const unboundedSource = <T>(endpoint: LiveSourceEndpoint, key: number | 'latest', invoke: (options: FetchOpts) => Promise<T>, options: FetchOpts) =>
    sourceCapable() && !options.dateGte && !options.dateLte
      ? runSource(endpoint, key, invoke, options)
      : run(endpoint, { session_key: key }, invoke, options);
  return {
    observedAt,
    /** Whether any read on this page was served from a stored earlier response, and from when. */
    freshness: (): OpenF1PageFreshness => summariseOpenF1Freshness(ledger),
    /** Read the actual acquisition observation clock without relabelling any
     * provider sample date or reusing the page's earlier creation timestamp. */
    snapshotObservedAt: () => now(),
    getLatestSession: (options: FetchOpts = {}) => unboundedSource('sessions', 'latest', (opts) => source.getLatestSession(opts), options),
    getDrivers: (key: number, options: FetchOpts = {}) => unboundedSource('drivers', key, (opts) => source.getDrivers(key, opts), options),
    getDriversByAcronym: (acronym: string, options: FetchOpts = {}) => {
      if (!/^[A-Z]{2,5}$/.test(acronym)) return Promise.reject(new ProviderError('openf1', 'invalid-input'));
      return run('drivers', { name_acronym: acronym }, (opts) => source.getDriversByAcronym(acronym, opts), options);
    },
    getPositions: (key: number, options: FetchOpts = {}) => run('position', { session_key: key }, (opts) => source.getPositions(key, opts), options),
    getIntervals: (key: number, options: FetchOpts = {}) => run('intervals', { session_key: key }, (opts) => source.getIntervals(key, opts), options),
    getStints: (key: number, options: FetchOpts = {}) => unboundedSource('stints', key, (opts) => source.getStints(key, opts), options),
    getWeather: (key: number, options: FetchOpts = {}) => unboundedSource('weather', key, (opts) => source.getWeather(key, opts), options),
    getRaceControl: (key: number, options: FetchOpts = {}) => run('race_control', { session_key: key }, (opts) => source.getRaceControl(key, opts), options),
    getLaps: (key: number, options: FetchOpts = {}) => run('laps', { session_key: key }, (opts) => source.getLaps(key, opts), options),
    getLocation: (key: number, options: FetchOpts & { driverNumber?: number } = {}) => run('location', { session_key: key, ...(options.driverNumber !== undefined ? { driver_number: options.driverNumber } : {}) }, (opts) => source.getLocation(key, { ...opts, driverNumber: options.driverNumber }), options),
  };
}
let configured: { identity: string; store: OpenF1ReadStore } | null = null;
export function createPageOpenF1Reader(options: Pick<ReaderDependencies, 'scheduleRefresh'> = {}) {
  const config = liveStoreConfig();
  if (!config) return createOpenF1PageReader({ store: null, direct: process.env.NODE_ENV !== 'production' });
  // Store transport is reused for private causal ordering. Credentials never
  // become public cache identities, errors, rows or logs.
  const identity = createHash('sha256').update(config.url + ':' + config.token).digest('hex');
  if (!configured || configured.identity !== identity) configured = { identity, store: createUpstashOpenF1ReadStore(config) };
  return createOpenF1PageReader({ store: configured.store, scheduleRefresh: options.scheduleRefresh });
}
