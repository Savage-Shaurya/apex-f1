import 'next/dist/server/node-environment';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { createOpenF1PageReader } from './openf1-shared-reader';
import type { OpenF1CachedRows, OpenF1ReadStore } from './openf1-read-store';
import { createLiveSourceSnapshot, liveSourceFreshnessMs, liveSourceQuery, type LiveSourceEndpoint, type LiveSourceSnapshot } from './live-source-snapshot';

const START = Date.parse('2026-10-04T12:00:00Z');
const session = { session_key: 42, meeting_key: 7, session_name: 'Race', session_type: 'Race', date_start: new Date(START).toISOString(), date_end: new Date(START + 7200000).toISOString(), circuit_key: 2, circuit_short_name: 'Silverstone', country_code: 'GBR', country_name: 'United Kingdom', location: 'Silverstone', gmt_offset: '00:00:00', year: 2026 };
function fixture() {
  let clock = START + 60000, sequence = 0, guard: { owner: string; until: number } | null = null;
  const starts: number[] = [], calls: Array<{ path: string; at: number }> = [];
  const caches = new Map<string, { value: OpenF1CachedRows; until: number }>();
  const locks = new Map<string, { owner: string; fence: number; until: number }>();
  const fences = new Map<string, number>();
  const waiters: Array<{ target: number; resolve: () => void; reject: () => void; signal: AbortSignal; abort: () => void }> = [];
  let ticking = false;
  const tick = () => {
    ticking = false; if (!waiters.length) return;
    clock = Math.max(clock, Math.min(...waiters.map((item) => item.target)));
    for (const item of [...waiters]) if (item.target <= clock) { waiters.splice(waiters.indexOf(item), 1); item.signal.removeEventListener('abort', item.abort); item.resolve(); }
    if (waiters.length) { ticking = true; setImmediate(tick); }
  };
  const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const item = { target: clock + ms, resolve, reject: () => reject(new Error('aborted')), signal, abort: () => {} };
    item.abort = () => { const index = waiters.indexOf(item); if (index !== -1) waiters.splice(index, 1); signal.removeEventListener('abort', item.abort); item.reject(); };
    signal.addEventListener('abort', item.abort, { once: true }); waiters.push(item);
    if (!ticking) { ticking = true; setImmediate(tick); }
  });
  const owned = (query: string, owner: string, fence: number) => { const lock = locks.get(query); return lock?.owner === owner && lock.fence === fence && lock.until > clock; };
  const store: OpenF1ReadStore = {
    async read(query, signal) { signal.throwIfAborted(); const entry = caches.get(query); return entry && entry.until > clock ? structuredClone(entry.value) : null; },
    async claim(query, owner, signal) {
      signal.throwIfAborted(); let lock = locks.get(query);
      if (!lock || lock.until <= clock) { const fence = (fences.get(query) ?? 0) + 1; fences.set(query, fence); lock = { owner, fence, until: clock + 25000 }; locks.set(query, lock); return { owner: true, fence, retryMs: 0 }; }
      return { owner: false, fence: lock.fence, retryMs: lock.until - clock };
    },
    async admit(owner, signal) {
      signal.throwIfAborted(); while (starts.length && starts[0]! <= clock - 60000) starts.shift();
      const delay = Math.max(0, (guard?.until ?? 0) - clock, starts.length ? starts.at(-1)! + 2300 - clock : 0, starts.length >= 26 ? starts[0]! + 60001 - clock : 0);
      if (delay) return { retryMs: delay, busy: !!guard && guard.until > clock };
      starts.push(clock); guard = { owner, until: clock + 20000 }; return { retryMs: 0, busy: false };
    },
    async publish(query, owner, fence, rows, ttl, signal) {
      signal.throwIfAborted(); if (!owned(query, owner, fence)) return null;
      const value: OpenF1CachedRows = { version: 1, query, writtenAt: clock, rows: structuredClone(rows) }; caches.set(query, { value, until: clock + ttl }); return structuredClone(value);
    },
    async release(query, owner, fence) { if (owned(query, owner, fence)) locks.delete(query); },
    async complete(owner) { if (guard?.owner === owner) guard.until = clock + 2300; },
  };
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input)); const path = url.pathname.split('/').at(-1)!; calls.push({ path, at: clock });
    const lower = url.searchParams.get('date>'), upper = url.searchParams.get('date<');
    const date = lower && upper ? new Date((Date.parse(lower + 'Z') + Date.parse(upper + 'Z')) / 2).toISOString() : new Date(START + 59000).toISOString();
    const base = { session_key: 42, driver_number: 4, date };
    const rows: Record<string, unknown[]> = {
      sessions: [{ ...session, secret_token: 'never-persist' }], drivers: [{ ...base, full_name: 'Local Driver', name_acronym: 'LOC', team_name: 'Local Team', team_colour: 'FF0000' }],
      position: [{ ...base, position: 1 }], intervals: [{ ...base, interval: 0, gap_to_leader: 0 }],
      stints: [{ ...base, stint_number: 1, compound: 'SOFT', lap_end: null }], weather: [{ session_key: 42, date, air_temperature: 24 }],
      race_control: [{ session_key: 42, date, category: 'Flag', message: 'GREEN' }], laps: [{ ...base, date_start: date, lap_number: 1, lap_duration: 80 }],
      location: [{ ...base, x: 1, y: 2, z: 3 }],
    };
    return Response.json(rows[path] ?? []);
  };
  const dependencies = { store, fetch: fetcher, now: () => clock, wait, ownerId: () => `reader-${++sequence}` };
  return { store, dependencies, caches, locks, starts, calls, now: () => clock, advance: (ms: number) => { clock += ms; } };
}

function sourceFixture() {
  const setup = fixture();
  const snapshots = new Map<string, LiveSourceSnapshot>();
  setup.store.readSource = async (query, signal) => {
    signal.throwIfAborted(); const value = snapshots.get(query);
    return value && setup.now() - value.acquisitionStartedAt < liveSourceFreshnessMs(value.endpoint) ? structuredClone(value) : null;
  };
  setup.store.publishSource = async (query, owner, fence, value, _ttl, signal) => {
    signal.throwIfAborted(); const lock = setup.locks.get(query);
    if (!lock || lock.owner !== owner || lock.fence !== fence || lock.until <= setup.now()) return null;
    snapshots.set(query, structuredClone(value)); return structuredClone(value);
  };
  const seed = async (endpoint: LiveSourceEndpoint, rows: unknown[], age = 0) => {
    const identity = { endpoint, sessionKey: endpoint === 'sessions' ? 'latest' as const : 42 };
    const value = await createLiveSourceSnapshot(identity, rows, { acquisitionStartedAt: setup.now() - age, acquisitionCompletedAt: setup.now() - age, coverageLower: null, coverageUpper: null }, setup.now());
    snapshots.set(value.query, value); return value;
  };
  return { ...setup, snapshots, seed };
}
test('forty readers across independent page instances coalesce one cache miss and preserve original values', async () => {
  const setup = fixture();
  const readers = Array.from({ length: 40 }, () => createOpenF1PageReader(setup.dependencies));
  const results = await Promise.all(readers.map((reader) => reader.getLatestSession()));
  assert.equal(setup.calls.length, 1); assert.ok(results.every((result) => result?.session_key === 42));
  assert.equal(setup.caches.size, 1); assert.equal(JSON.stringify([...setup.caches.values()]).includes('never-persist'), false);
  const warm = await createOpenF1PageReader(setup.dependencies).getLatestSession(); assert.deepEqual(warm, results[0]); assert.equal(setup.calls.length, 1);
});

test('slow cold owner does not cause forty followers to flood Redis while preserving one provider read', async () => {
  const setup = fixture();
  let reads = 0, claims = 0;
  const originalRead = setup.store.read, originalClaim = setup.store.claim;
  setup.store.read = async (...args) => { reads++; return originalRead(...args); };
  setup.store.claim = async (...args) => { claims++; return originalClaim(...args); };
  const fetcher: typeof fetch = async (input, options) => {
    await setup.dependencies.wait(5000, options?.signal ?? new AbortController().signal);
    return setup.dependencies.fetch(input, options);
  };
  const before = setup.now();
  const results = await Promise.all(Array.from({ length: 40 }, () => createOpenF1PageReader({ ...setup.dependencies, fetch: fetcher }).getLatestSession()));
  assert.equal(setup.calls.length, 1);
  assert.ok(results.every(value => value?.session_key === 42));
  assert.ok(reads <= 500, `Cold followers made ${reads} Redis cache reads`);
  assert.ok(claims <= 450, `Cold followers made ${claims} Redis lock claims`);
  assert.ok(setup.now() - before <= 6000, 'Cache publication must be noticed within one second');
});

test('followers stop at the whole-page deadline without upstream work or releasing another lock', async () => {
  const setup = fixture();
  let claims = 0;
  const originalClaim = setup.store.claim;
  setup.store.claim = async (query, _owner, signal) => {
    claims++;
    await originalClaim(query, 'other-owner', signal);
    return { owner: false, fence: 1, retryMs: 25000 };
  };
  const before = setup.now();
  // Queue exhaustion is a fallback-eligible timeout (R3-BE-1), reported before the budget ends.
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getLatestSession(), (error: ProviderError) => error.code === 'timeout');
  assert.equal(setup.calls.length, 0);
  assert.ok(setup.now() - before <= 20000);
  assert.ok(claims <= 24, `Deadline wait made ${claims} repeated lock claims`);
  assert.ok([...setup.locks.values()].every(lock => lock.owner === 'other-owner'));
});
test('cold timing collections fill inside one twenty-second budget and warm reads consume zero additional provider slots', async () => {
  const setup = fixture(); const before = setup.now(); const reader = createOpenF1PageReader(setup.dependencies);
  const current = await reader.getLatestSession(); assert.equal(current!.session_key, 42);
  const load = (value: ReturnType<typeof createOpenF1PageReader>) => Promise.all([value.getDrivers(42), value.getPositions(42), value.getIntervals(42), value.getStints(42), value.getWeather(42)]);
  const cold = await load(reader); assert.equal(setup.calls.length, 6); assert.ok(setup.now() - before <= 20000);
  for (let index = 1; index < setup.calls.length; index++) assert.ok(setup.calls[index]!.at - setup.calls[index - 1]!.at >= 2300);
  const dates = cold[1].map((row) => row.date); const warm = await load(createOpenF1PageReader(setup.dependencies));
  assert.deepEqual(warm[1].map((row) => row.date), dates); assert.equal(setup.calls.length, 6); assert.equal(setup.starts.length, 6);
});
test('strict cached response identities, metadata and age are rechecked without a provider fallback', async () => {
  for (const corruption of ['identity', 'metadata', 'future']) {
    const setup = fixture(); await createOpenF1PageReader(setup.dependencies).getLatestSession();
    const entry = [...setup.caches.values()][0]!;
    if (corruption === 'identity') (entry.value.rows[0] as Record<string, unknown>).session_key = 0;
    if (corruption === 'metadata') (entry.value.rows[0] as Record<string, unknown>).location = undefined;
    if (corruption === 'future') entry.value.writtenAt = setup.now() + 6000;
    if (corruption === 'old') entry.value.writtenAt = setup.now() - 31000;
    await assert.rejects(createOpenF1PageReader(setup.dependencies).getLatestSession(), ProviderError);
    assert.equal(setup.calls.length, 1);
  }
});
test('a cached entry past its TTL by this server clock is a miss that refetches, not a failure (R3-BE-5)', async () => {
  const setup = fixture(); await createOpenF1PageReader(setup.dependencies).getLatestSession();
  const entry = [...setup.caches.values()][0]!;
  entry.value.writtenAt = setup.now() - 31000;
  assert.equal((await createOpenF1PageReader(setup.dependencies).getLatestSession())!.session_key, 42);
  assert.equal(setup.calls.length, 2);
});
test('confirmed empty session is durable empty data and missing shared config fails closed', async () => {
  const setup = fixture(); const dependencies = { ...setup.dependencies, fetch: async () => Response.json([]) };
  assert.equal(await createOpenF1PageReader(dependencies).getLatestSession(), null);
  assert.deepEqual([...setup.caches.values()][0]!.value.rows, []);
  assert.equal(await createOpenF1PageReader(dependencies).getLatestSession(), null);
  await assert.rejects(createOpenF1PageReader({ store: null }).getLatestSession(), (error: ProviderError) => error.code === 'configuration');
});
test('an exhausted account quota fails within the page budget without a provider attempt or quota refund', async () => {
  const setup = fixture(); setup.starts.push(...Array.from({ length: 26 }, (_, index) => setup.now() - index * 500));
  const before = setup.now(); await assert.rejects(createOpenF1PageReader(setup.dependencies).getLatestSession(), (error: ProviderError) => error.code === 'rate-limit');
  assert.ok(setup.now() - before <= 20000); assert.equal(setup.calls.length, 0); assert.equal(setup.starts.length, 26);
});
test('caller abort is immediate while a cache owner is busy and cannot release another owner', async () => {
  const setup = fixture(); const originalClaim = setup.store.claim;
  setup.store.claim = async (query, owner, signal) => { await originalClaim(query, 'other-owner', signal); return { owner: false, fence: 1, retryMs: 25000 }; };
  const controller = new AbortController(); const pending = createOpenF1PageReader(setup.dependencies).getLatestSession({ signal: controller.signal });
  await Promise.resolve(); controller.abort(); await assert.rejects(pending, ProviderError);
  assert.equal(setup.calls.length, 0); assert.ok([...setup.locks.values()].every((lock) => lock.owner === 'other-owner'));
});

test('cancellation racing an acquired cache lock releases its own fence without upstream work', async () => {
  const setup = fixture(); const controller = new AbortController();
  const originalClaim = setup.store.claim;
  let releases = 0;
  const originalRelease = setup.store.release;
  setup.store.release = async (...args) => { releases++; return originalRelease(...args); };
  setup.store.claim = async (...args) => { const result = await originalClaim(...args); controller.abort(); return result; };
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getLatestSession({ signal: controller.signal }), ProviderError);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(setup.calls.length, 0); assert.equal(setup.starts.length, 0);
  assert.equal(releases, 1); assert.equal(setup.locks.size, 0);
});

test('cancellation racing provider admission completes only its own dispatch without refunding quota', async () => {
  const setup = fixture(); const controller = new AbortController();
  const originalAdmit = setup.store.admit;
  let completions = 0;
  const originalComplete = setup.store.complete;
  setup.store.complete = async (...args) => { completions++; return originalComplete(...args); };
  setup.store.admit = async (...args) => { const result = await originalAdmit(...args); controller.abort(); return result; };
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getLatestSession({ signal: controller.signal }), ProviderError);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(setup.calls.length, 0); assert.equal(setup.starts.length, 1);
  assert.equal(completions, 1); assert.equal(setup.locks.size, 0);
});
test('invalid date and acronym inputs allocate neither provider admission nor shared cache keys', async () => {
  const setup = fixture(); const reader = createOpenF1PageReader(setup.dependencies);
  await assert.rejects(reader.getLocation(42, { dateGte: '2026-02-30T12:00:00Z', dateLte: '2026-03-01T12:00:00Z' }), ProviderError);
  await assert.rejects(reader.getDriversByAcronym('unsafe/url'), ProviderError);
  assert.equal(setup.calls.length, 0); assert.equal(setup.locks.size, 0); assert.equal(setup.starts.length, 0);
});

test('long validated position history is compacted to newest original per-driver records before durable caching', async () => {
  const setup = fixture();
  const history = Array.from({ length: 16000 }, (_, index) => ({ session_key: 42, driver_number: index % 20 + 1, position: index % 20 + 1, date: new Date(START + index).toISOString() }));
  const reader = createOpenF1PageReader({ ...setup.dependencies, fetch: async () => Response.json(history) });
  const rows = await reader.getPositions(42); assert.equal(rows.length, 20);
  const cached = [...setup.caches.values()][0]!; assert.equal(cached.value.rows.length, 20);
  for (const row of rows) assert.equal(row.date, history.filter((item) => item.driver_number === row.driver_number).at(-1)!.date);
});

test('cached position compaction cannot hide an older foreign-session record behind a newer valid row', async () => {
  const setup = fixture(); await createOpenF1PageReader(setup.dependencies).getPositions(42);
  const cached = [...setup.caches.values()][0]!.value;
  cached.rows.push({ session_key: 99, driver_number: 4, position: 2, date: new Date(START + 1000).toISOString() });
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getPositions(42), (error: ProviderError) => error.code === 'invalid-response');
  assert.equal(setup.calls.length, 1);
});

test('future telemetry timestamps fail unavailable while scheduled future sessions remain valid', async () => {
  const setup = fixture();
  const row = { session_key: 42, driver_number: 4, position: 1, date: new Date(setup.now() + 6000).toISOString() };
  await assert.rejects(createOpenF1PageReader({ ...setup.dependencies, fetch: async () => Response.json([row]) }).getPositions(42), (error: ProviderError) => error.code === 'invalid-response');
  assert.equal(setup.caches.size, 0);
  const futureSession = { ...session, date_start: new Date(setup.now() + 60000).toISOString() };
  assert.equal((await createOpenF1PageReader({ ...setup.dependencies, fetch: async () => Response.json([futureSession]) }).getLatestSession())!.date_start, futureSession.date_start);
});

test('one globally claimed tracked stints refresh serves forty callers and starts with its own budget', async () => {
  const setup = sourceFixture(); const jobs: Array<() => Promise<void>> = [];
  const first = await createOpenF1PageReader(setup.dependencies).getStints(42);
  const original = setup.snapshots.get(liveSourceQuery('stints', 42))!;
  setup.advance(30000);
  const dependencies = { ...setup.dependencies, scheduleRefresh: (job: () => Promise<void>) => { jobs.push(job); } };
  const readers = Array.from({ length: 40 }, () => createOpenF1PageReader(dependencies));
  const warm = await Promise.all(readers.map(reader => reader.getStints(42)));
  assert.ok(warm.every(value => JSON.stringify(value) === JSON.stringify(first)));
  assert.equal(jobs.length, 1); assert.equal(setup.calls.length, 1);
  setup.advance(21000); // The page budget expired; the durable job has its own budget.
  await jobs[0]!();
  assert.equal(setup.calls.length, 2); assert.equal(setup.locks.size, 0);
  const refreshed = setup.snapshots.get(original.query)!;
  assert.ok(refreshed.acquisitionStartedAt > original.acquisitionStartedAt);
  assert.equal(setup.now() - refreshed.acquisitionStartedAt, 0);
});

test('canceled or superseded scheduled refresh cannot call providers or release another owner', async () => {
  const setup = sourceFixture(); await createOpenF1PageReader(setup.dependencies).getStints(42); setup.advance(30000);
  const jobs: Array<() => Promise<void>> = []; const caller = new AbortController();
  await createOpenF1PageReader({ ...setup.dependencies, scheduleRefresh: job => { jobs.push(job); } }).getStints(42, { signal: caller.signal });
  caller.abort(); await assert.rejects(jobs[0]!(), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.equal(setup.locks.size, 0); assert.equal(setup.calls.length, 1);
  await createOpenF1PageReader({ ...setup.dependencies, scheduleRefresh: job => { jobs.push(job); } }).getStints(42);
  const query = liveSourceQuery('stints', 42), previous = setup.locks.get(query)!;
  setup.advance(25000); const successor = { owner: 'successor', fence: previous.fence + 1, until: setup.now() + 25000 }; setup.locks.set(query, successor);
  await assert.rejects(jobs[1]!(), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.deepEqual(setup.locks.get(query), successor); assert.equal(setup.calls.length, 1);
});

test('refresh scheduling and source store failure reject honestly and release only acquired work', async () => {
  const setup = sourceFixture(); await createOpenF1PageReader(setup.dependencies).getStints(42); setup.advance(30000);
  await assert.rejects(createOpenF1PageReader({ ...setup.dependencies, scheduleRefresh: () => { throw new Error('No durable lifetime'); } }).getStints(42), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.equal(setup.locks.size, 0); assert.equal(setup.calls.length, 1);
  setup.store.readSource = async () => { throw new Error('Shared cache unavailable'); };
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getWeather(42), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.equal(setup.calls.length, 1);
});

test('raw metadata freshness stays at sixty seconds while exact legacy driver TTL is unchanged', async () => {
  const setup = sourceFixture(); await createOpenF1PageReader(setup.dependencies).getDrivers(42);
  const raw = setup.snapshots.get(liveSourceQuery('drivers', 42))!;
  setup.advance(59999); assert.ok(await setup.store.readSource!(raw.query, new AbortController().signal)); assert.equal(setup.calls.length, 1);
  setup.advance(1); await createOpenF1PageReader(setup.dependencies).getDrivers(42); assert.equal(setup.calls.length, 2);
  assert.ok(setup.snapshots.get(raw.query)!.acquisitionStartedAt > raw.acquisitionStartedAt);
  const legacy = fixture(); await createOpenF1PageReader(legacy.dependencies).getDrivers(42);
  legacy.advance(60000); await createOpenF1PageReader(legacy.dependencies).getDrivers(42); assert.equal(legacy.calls.length, 1);
});

test('schedulerless callers await proactive refresh within their original remaining page budget', async () => {
  const setup = sourceFixture(); await createOpenF1PageReader(setup.dependencies).getStints(42); setup.advance(30000);
  await createOpenF1PageReader(setup.dependencies).getStints(42);
  assert.equal(setup.calls.length, 2); assert.equal(setup.locks.size, 0);
  setup.advance(30000);
  const lateReader = createOpenF1PageReader(setup.dependencies); setup.advance(19900);
  const before = setup.now(); setup.store.admit = async () => ({ retryMs: 1000, busy: true });
  // The admission queue stops LAST_GOOD_RESERVE_MS before the budget ends with a timeout (R3-BE-1).
  await assert.rejects(lateReader.getStints(42), (error: unknown) => error instanceof ProviderError && error.code === 'timeout');
  assert.ok(setup.now() - before <= 100); assert.equal(setup.calls.length, 2); assert.equal(setup.locks.size, 0);
});

test('raw cancellation racing successful claim or admission preserves exact cleanup and consumed pacing', async () => {
  const claimed = sourceFixture(); const caller = new AbortController(); const originalClaim = claimed.store.claim;
  claimed.store.claim = async (...args) => { const value = await originalClaim(...args); caller.abort(); return value; };
  await assert.rejects(createOpenF1PageReader(claimed.dependencies).getLatestSession({ signal: caller.signal }), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.equal(claimed.locks.size, 0); assert.equal(claimed.calls.length, 0);
  const admitted = sourceFixture(); const canceled = new AbortController(); const originalAdmission = admitted.store.admit;
  admitted.store.admit = async (...args) => { const value = await originalAdmission(...args); canceled.abort(); return value; };
  const before = admitted.now();
  await assert.rejects(createOpenF1PageReader(admitted.dependencies).getLatestSession({ signal: canceled.signal }), (error: unknown) => error instanceof ProviderError && error.code === 'incomplete');
  assert.equal(admitted.locks.size, 0); assert.equal(admitted.calls.length, 0); assert.equal(admitted.starts.length, 1);
  admitted.store.admit = originalAdmission;
  assert.equal((await createOpenF1PageReader(admitted.dependencies).getLatestSession())?.session_key, 42);
  assert.equal(admitted.calls[0]!.at - before, 2300);
});

test('installed Next after retains a claimed refresh until response close and awaits its cleanup', async () => {
  const { after } = await import('next/server');
  const { AfterContext } = await import('next/dist/server/after/after-context');
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external');
  const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
  const setup = sourceFixture(); await createOpenF1PageReader(setup.dependencies).getStints(42); setup.advance(30000);
  const closes: Array<() => void> = [], lifetimes: Promise<unknown>[] = [], errors: unknown[] = [];
  const afterContext = new AfterContext({ waitUntil: promise => { lifetimes.push(promise); }, onClose: callback => { closes.push(callback); }, onTaskError: error => { errors.push(error); } });
  const work = { afterContext, route: '/live/timing', pendingRevalidates: {}, pendingRevalidatedTags: [], pendingRevalidateWrites: [] } as unknown as Parameters<typeof workAsyncStorage.run>[0];
  const unit = { type: 'request', phase: 'render' } as unknown as Parameters<typeof workUnitAsyncStorage.run>[0];
  await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(unit, () => createOpenF1PageReader({ ...setup.dependencies, scheduleRefresh: job => after(job) }).getStints(42)));
  assert.equal(lifetimes.length, 1); assert.equal(setup.calls.length, 1); assert.equal(setup.locks.size, 1);
  setup.advance(21000); closes.forEach(close => close());
  await Promise.all(lifetimes);
  assert.deepEqual(errors, []); assert.equal(setup.calls.length, 2); assert.equal(setup.locks.size, 0);
});
test('raw snapshot validation rejects hidden foreign rows and expired acquisitions without provider fallback', async () => {
  const setup = sourceFixture();
  const row = { session_key: 42, driver_number: 4, stint_number: 1, compound: 'SOFT', lap_start: 1, lap_end: 10, tyre_age_at_start: 0 };
  const value = await setup.seed('stints', [row]);
  setup.snapshots.set(value.query, { ...value, rows: [{ ...row, session_key: 99 }, row] });
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getStints(42), (error: unknown) => error instanceof ProviderError && error.code === 'invalid-response');
  setup.snapshots.set(value.query, value); setup.advance(liveSourceFreshnessMs('stints') + 1000);
  // A broken store returning an expired envelope cannot turn it into fresh data.
  setup.store.readSource = async () => structuredClone(value);
  await assert.rejects(createOpenF1PageReader(setup.dependencies).getStints(42), (error: unknown) => error instanceof ProviderError);
  assert.equal(setup.calls.length, 0);
});
test('confirmed absent and future sessions remain distinct through the raw source cache', async () => {
  const setup = sourceFixture();
  const empty = await setup.seed('sessions', []);
  assert.equal(await createOpenF1PageReader(setup.dependencies).getLatestSession(), null);
  setup.snapshots.delete(empty.query);
  await setup.seed('sessions', [{ ...session, date_start: new Date(setup.now() + 3600000).toISOString(), date_end: new Date(setup.now() + 7200000).toISOString() }]);
  const future = await createOpenF1PageReader(setup.dependencies).getLatestSession();
  assert.ok(future && Date.parse(future.date_start) > setup.now()); assert.equal(setup.calls.length, 0);
  await assert.rejects(createOpenF1PageReader({ store: null }).getStints(42), (error: unknown) => error instanceof ProviderError && error.code === 'configuration');
});
