import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDistributedLiveSessionHub } from './live-distributed-hub';
import { LIVE_LEASE_MS, LIVE_REQUEST_GAP_MS, LIVE_REQUESTS_PER_MINUTE, type LiveSharedSnapshot, type LiveSharedStore } from './live-shared-store';
import type { HubDependencies, LiveFrame } from './live-session-hub';
import { sanitizeLiveFrames } from './live-frame-schema';
import type { OpenF1ReadStore } from './openf1-read-store';
import { liveSourceQuery, liveSourceSnapshotRows, type LiveSourceSnapshot } from './live-source-snapshot';

const START = Date.parse('2026-10-04T12:00:00Z');
/** Exact atomic store semantics, injected locally. Never calls Redis or a provider. */
function fixture() {
  let clock = START + 60_000;
  let lease: { owner: string; fence: number; until: number } | null = null;
  let fence = 0;
  let revision = 0;
  let snapshot: LiveSharedSnapshot | null = null;
  const starts: number[] = [];
  const calls: Array<{ channel: string; at: number }> = [];
  let broken = false;
  let beforePublish: (() => void) | null = null;
  const check = (signal: AbortSignal) => { signal.throwIfAborted(); if (broken) throw new Error('offline'); };
  const owned = (owner: string, expected: number) => !!lease && lease.owner === owner && lease.fence === expected && lease.until > clock;
  const store: LiveSharedStore = {
    async claim(owner, signal) {
      check(signal);
      if (!lease || lease.until <= clock) lease = { owner, fence: ++fence, until: clock + LIVE_LEASE_MS };
      if (lease.owner === owner) lease.until = clock + LIVE_LEASE_MS;
      return { owner: lease.owner === owner, fence: lease.fence };
    },
    async reserve(owner, expected, signal) {
      check(signal);
      if (!owned(owner, expected)) return { owned: false, retryMs: 0 };
      lease!.until = clock + LIVE_LEASE_MS;
      while (starts.length && starts[0]! <= clock - 60_000) starts.shift();
      const gap = starts.length ? starts.at(-1)! + LIVE_REQUEST_GAP_MS - clock : 0;
      const quota = starts.length >= LIVE_REQUESTS_PER_MINUTE ? starts[0]! + 60_001 - clock : 0;
      const retryMs = Math.max(0, gap, quota);
      if (!retryMs) starts.push(clock);
      return { owned: true, retryMs };
    },
    async publish(owner, expected, frames, signal) {
      check(signal);
      beforePublish?.(); beforePublish = null;
      if (!owned(owner, expected)) return null;
      const clean = sanitizeLiveFrames(frames);
      if (!clean) throw new Error('Mixed or invalid snapshot');
      snapshot = { version: 1, fence: expected, revision: ++revision, writtenAt: clock, frames: clean };
      lease!.until = clock + LIVE_LEASE_MS;
      return structuredClone(snapshot);
    },
    async read(signal) { check(signal); return snapshot ? structuredClone(snapshot) : null; },
    async release(owner, expected, signal) { check(signal); if (owned(owner, expected)) lease!.until = clock + LIVE_REQUEST_GAP_MS; },
  };
  const call = (channel: string) => { calls.push({ channel, at: clock }); };
  const date = () => new Date(clock - 1_000).toISOString();
  const dependencies: HubDependencies = {
    now: () => clock, wait: async (ms, signal) => { signal.throwIfAborted(); clock += ms; },
    access: () => ({ realtimeConfigured: true }),
    source: {
      async getLatestSession() { call('session'); return { session_key: 42, session_type: 'Race', session_name: 'Race', date_start: new Date(START).toISOString(), date_end: new Date(START + 7_200_000).toISOString(), meeting_key: 1, circuit_key: 1, circuit_short_name: 'Test', country_code: 'TST', country_name: 'Test', location: 'Test', gmt_offset: '+00:00', year: 2026 }; },
      async getDrivers() { call('drivers'); return [{ session_key: 42, driver_number: 4, full_name: 'Local Driver', name_acronym: 'LOC', team_name: 'Local Team', team_colour: 'FF0000', country_code: 'TST' }]; },
      async getPositions() { call('positions'); return [{ session_key: 42, driver_number: 4, position: 1, date: date() }]; },
      async getIntervals() { call('intervals'); return [{ session_key: 42, driver_number: 4, gap_to_leader: 0, interval: '+1 LAP', date: date() }]; },
      async getRaceControl() { call('race_control'); return [{ session_key: 42, date: date(), category: 'Flag', message: 'GREEN' }]; },
      async getWeather() { call('weather'); return [{ session_key: 42, date: date(), air_temperature: 24 }]; },
    },
  };
  return { dependencies, store, calls, now: () => clock, snapshot: () => snapshot, lease: () => lease,
    advance: (ms: number) => { clock += ms; }, breakStore: () => { broken = true; }, restoreStore: () => { broken = false; },
    onPublish: (callback: () => void) => { beforePublish = callback; } };
}
const signal = () => new AbortController().signal;
async function advanceOwned(setup: ReturnType<typeof fixture>, owner: string, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds;) {
    const step = Math.min(5_000, milliseconds - elapsed);
    setup.advance(step); elapsed += step;
    assert.equal((await setup.store.claim(owner, signal())).owner, true);
  }
}

test('two instances and forty viewers deduplicate ingestion and share timestamp-identical snapshots', async () => {
  const setup = fixture();
  const first = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'first' }, { automatic: false });
  const second = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'second' }, { automatic: false });
  const captures: LiveFrame[][] = Array.from({ length: 40 }, () => []);
  const leave = captures.map((frames, index) => (index < 20 ? first : second).subscribe((frame) => frames.push(frame)));
  await Promise.all(Array.from({ length: 20 }, () => Promise.all([first.refresh(signal()), second.refresh(signal())])));
  await second.refresh(signal());
  assert.equal(setup.calls.length, 6);
  assert.equal(first.metrics().owner, true);
  assert.equal(second.metrics().owner, false);
  for (const frames of captures) assert.deepEqual(frames.filter((frame) => frame.event === 'tower').at(-1)?.data, captures[0]!.filter((frame) => frame.event === 'tower').at(-1)?.data);
  for (const remove of leave) { remove(); remove(); }
  assert.equal(first.metrics().subscribers + second.metrics().subscribers, 0);
  assert.ok(first.metrics().retainedFrames <= 4 && second.metrics().retainedFrames <= 4);
  first.dispose(); second.dispose();
});

test('followers receive a fenced original timing sample while a later weather channel is still pending', async () => {
  const setup = fixture();
  const originalWeather = setup.dependencies.source.getWeather;
  let releaseWeather!: () => void;
  const weatherGate = new Promise<void>(resolve => { releaseWeather = resolve; });
  setup.dependencies.source.getWeather = async (key, options) => { await weatherGate; return originalWeather(key, options); };
  const leader = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'partial-owner' }, { automatic: false });
  const follower = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'partial-follower' }, { automatic: false });
  const frames: LiveFrame[] = [];
  follower.subscribe(frame => frames.push(frame));
  const refresh = leader.refresh(signal());
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(setup.snapshot()!.frames.some(frame => frame.event === 'weather'), false);
  assert.ok(setup.snapshot()!.frames.some(frame => frame.event === 'tower' && frame.data.dataTimestamp !== null));
  await follower.refresh(signal());
  const tower = frames.filter(frame => frame.event === 'tower').at(-1)!;
  assert.equal(tower.data.delivery, 'live');
  assert.equal(tower.data.sourceUpdatedAt, tower.data.dataTimestamp);
  assert.equal(tower.data.dataTimestamp, setup.snapshot()!.frames.find(frame => frame.event === 'tower')!.data.dataTimestamp);
  assert.equal(frames.some(frame => frame.event === 'weather'), false);
  assert.equal(follower.metrics().owner, false);
  releaseWeather(); await refresh; await follower.refresh(signal());
  assert.ok(frames.some(frame => frame.event === 'weather'));
  leader.dispose(); follower.dispose();
});

test('a fence lost on an incremental position publication stops remaining channels and preserves unavailable delivery', async () => {
  const setup = fixture();
  const originalPublish = setup.store.publish;
  setup.store.publish = async (owner, fence, frames, signal) => {
    if (frames.some(frame => frame.event === 'tower' && typeof frame.data.dataTimestamp === 'number')) setup.advance(LIVE_LEASE_MS + 1);
    return originalPublish(owner, fence, frames, signal);
  };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'partial-lost' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe(frame => frames.push(frame));
  await hub.refresh(signal());
  assert.deepEqual(setup.calls.map(value => value.channel), ['session', 'drivers', 'positions']);
  assert.equal(frames.some(frame => frame.event === 'tower' && frame.data.delivery === 'live'), false);
  assert.equal(frames.filter(frame => frame.event === 'session_state').at(-1)!.data.delivery, 'unavailable');
  assert.equal(hub.metrics().owner, false);
  hub.dispose();
});

function rawStoreFixture() {
  const snapshots: LiveSourceSnapshot[] = [];
  const releases: Array<{ query: string; owner: string; fence: number; aborted: boolean }> = [];
  const captures: Array<{ queryOwner: string; queryFence: number; liveOwner: string; liveFence: number }> = [];
  let rejectPublication = false;
  const store: OpenF1ReadStore = {
    async read() { throw new Error('Unexpected legacy read'); },
    async readSource() { return null; },
    async claim() { return { owner: true, fence: 3, retryMs: 0 }; },
    async admit() { throw new Error('Live source sharing must not reserve a second provider slot'); },
    async publish() { throw new Error('Unexpected legacy publication'); },
    async publishSource() { throw new Error('Unexpected unfenced live publication'); },
    async publishLiveSource(_query, queryOwner, queryFence, liveOwner, liveFence, snapshot) {
      captures.push({ queryOwner, queryFence, liveOwner, liveFence });
      if (rejectPublication) return null;
      snapshots.push(structuredClone(snapshot)); return snapshot;
    },
    async release(query, owner, fence, signal) { releases.push({ query, owner, fence, aborted: signal.aborted }); },
    async complete() { throw new Error('Live sharing must not complete a separately admitted provider slot'); },
  };
  return { store, snapshots, captures, releases, reject: () => { rejectPublication = true; } };
}

test('live raw sharing preserves actual endpoint bounds, original rows and both captured publication fences', async () => {
  const setup = fixture(), raw = rawStoreFixture();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, sourceStore: raw.store, ownerId: 'raw-owner' }, { automatic: false });
  await hub.refresh(signal());
  assert.equal(setup.calls.length, 6);
  assert.deepEqual(raw.snapshots.map(value => value.endpoint), ['sessions', 'drivers', 'position', 'intervals', 'race_control', 'weather']);
  assert.ok(raw.captures.every(value => value.liveOwner === 'raw-owner_0' && value.liveFence === hub.metrics().fence && value.queryFence === 3));
  assert.equal(new Set(raw.captures.map(value => value.queryOwner)).size, 6);
  const positions = raw.snapshots.find(value => value.endpoint === 'position')!;
  assert.equal((positions.rows[0] as { date: string }).date, new Date(positions.acquisitionStartedAt - 1_000).toISOString());
  assert.equal(positions.coverageUpper, new Date(positions.acquisitionStartedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  assert.ok(Date.parse(positions.coverageLower!) < Date.parse(positions.coverageUpper!));
  assert.ok(raw.releases.every(value => value.fence === 3 && !value.aborted));
  assert.equal(raw.releases.length, 6);
  hub.dispose();
});

test('lost raw publication ownership aborts remaining live source work and releases only the captured query claim', async () => {
  const setup = fixture(), raw = rawStoreFixture(); raw.reject();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, sourceStore: raw.store, ownerId: 'raw-failed' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe(frame => frames.push(frame));
  await hub.refresh(signal());
  assert.deepEqual(setup.calls.map(value => value.channel), ['session']);
  assert.equal(raw.snapshots.length, 0);
  assert.equal(raw.releases.length, 1);
  assert.equal(raw.releases[0]!.owner, raw.captures[0]!.queryOwner);
  assert.equal(raw.releases[0]!.fence, 3);
  assert.equal(frames.at(-1)!.data.delivery, 'unavailable');
  assert.equal(hub.metrics().owner, false);
  hub.dispose();
});

test('a busy initial raw position claim cannot erase original sparse positions from the later overlap snapshot', async () => {
  const setup = fixture(), raw = rawStoreFixture();
  const positionQuery = liveSourceQuery('position', 42);
  const originalClaim = raw.store.claim;
  let firstPosition = true;
  raw.store.claim = async (...args) => {
    if (args[0] === positionQuery && firstPosition) { firstPosition = false; return { owner: false, fence: 3, retryMs: 1000 }; }
    return originalClaim(...args);
  };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, sourceStore: raw.store, ownerId: 'raw-busy' }, { automatic: false });
  await hub.refresh(signal());
  assert.equal(raw.snapshots.some(value => value.endpoint === 'position'), false);
  setup.dependencies.source.getPositions = async () => [];
  await advanceOwned(setup, 'raw-busy_0', 13_000);
  await hub.refresh(signal());
  const positions = raw.snapshots.find(value => value.endpoint === 'position')!;
  assert.deepEqual(positions.rows, []);
  const retained = liveSourceSnapshotRows(positions) as Array<{ driver_number: number; position: number; date: string }>;
  assert.equal(retained.length, 1);
  assert.equal(retained[0]!.driver_number, 4);
  assert.equal(retained[0]!.position, 1);
  assert.equal(retained[0]!.date, new Date(START + 60_000 + 2 * LIVE_REQUEST_GAP_MS - 1000).toISOString());
  assert.ok(positions.positionCarry![0]!.acquisitionStartedAt < positions.acquisitionStartedAt);
  hub.dispose();
});

test('successor takes over an expired owner and old fence can neither reserve nor overwrite', async () => {
  const setup = fixture();
  const first = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'first' }, { automatic: false });
  const second = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'second' }, { automatic: false });
  await first.refresh(signal());
  const oldFence = first.metrics().fence!;
  setup.advance(LIVE_LEASE_MS + 1);
  await second.refresh(signal());
  assert.ok(second.metrics().fence! > oldFence);
  assert.deepEqual(await setup.store.reserve('first_0', oldFence, signal()), { owned: false, retryMs: 0 });
  assert.equal(await setup.store.publish('first_0', oldFence, [{ event: 'session_state', data: { state: 'no_session' } }], signal()), null);
  const successor = setup.lease();
  await setup.store.release('first_0', oldFence, signal());
  assert.deepEqual(setup.lease(), successor);
  first.dispose(); second.dispose();
});

test('global live-ingestion quota and spacing survive alternating instance ownership', async () => {
  const setup = fixture();
  for (let index = 0; index < 8; index += 1) {
    const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: `owner${index}` }, { automatic: false });
    await hub.refresh(signal());
    hub.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    setup.advance(LIVE_REQUEST_GAP_MS + 1);
  }
  assert.equal(setup.calls.length, 48);
  for (let index = 1; index < setup.calls.length; index += 1) assert.ok(setup.calls[index]!.at - setup.calls[index - 1]!.at >= LIVE_REQUEST_GAP_MS);
  for (const call of setup.calls) assert.ok(setup.calls.filter((other) => other.at > call.at - 60_000 && other.at <= call.at).length <= LIVE_REQUESTS_PER_MINUTE);
});

test('followers age original samples without rewriting timestamps or declaring cached data live', async () => {
  const setup = fixture();
  const leader = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'leader' }, { automatic: false });
  await leader.refresh(signal());
  const expected = setup.snapshot()!.frames.find((frame) => frame.event === 'tower')!.data.dataTimestamp;
  setup.advance(31_000);
  // Keep the same owner alive but do not refresh its telemetry snapshot.
  await setup.store.claim('leader_0', signal());
  const follower = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'follower' }, { automatic: false });
  const frames: LiveFrame[] = [];
  follower.subscribe((frame) => frames.push(frame));
  await follower.refresh(signal());
  const tower = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal(tower.data.dataTimestamp, expected);
  assert.equal(tower.data.sourceUpdatedAt, expected);
  assert.equal(tower.data.delivery, 'stale');
  assert.equal(setup.calls.length, 6);
  leader.dispose(); follower.dispose();
});

test('shared outage retains real last-known rows and explicitly reports unavailable', async () => {
  const setup = fixture();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'one' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(signal());
  const originalTime = frames.filter((frame) => frame.event === 'tower').at(-1)!.data.dataTimestamp;
  setup.breakStore();
  await hub.refresh(signal());
  assert.equal(frames.filter((frame) => frame.event === 'session_state').at(-1)!.data.delivery, 'unavailable');
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal(last.data.delivery, 'stale');
  assert.equal(last.data.dataTimestamp, originalTime);
  assert.equal((last.data.rows as unknown[]).length, 1);
  assert.equal(setup.calls.length, 6);
  hub.dispose();
});

test('shared outage marks retained weather and race control delayed, including reconnect replay, and recovery clears the flags', async () => {
  const setup = fixture();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'weather-outage' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(signal());
  const original = new Map(['weather', 'race_control'].map(event => [event, frames.filter(frame => frame.event === event).at(-1)!.data]));
  for (const data of original.values()) assert.equal(data.stale, false);
  setup.breakStore();
  await hub.refresh(signal());
  for (const event of ['weather', 'race_control'] as const) {
    const retained = frames.filter(frame => frame.event === event).at(-1)!.data;
    assert.deepEqual(retained, { ...original.get(event), stale: true });
  }
  const replay: LiveFrame[] = [];
  hub.subscribe(frame => replay.push(frame));
  for (const event of ['weather', 'race_control'] as const) {
    const retained = replay.find(frame => frame.event === event)!.data;
    assert.deepEqual(retained, { ...original.get(event), stale: true });
  }
  const delivered = frames.length;
  await hub.refresh(signal());
  assert.equal(frames.length, delivered);
  assert.equal(setup.calls.length, 6);
  setup.restoreStore();
  await hub.refresh(signal());
  for (const event of ['weather', 'race_control'] as const) {
    const recovered = frames.filter(frame => frame.event === event).at(-1)!.data;
    assert.equal(recovered.stale, false);
    assert.equal(recovered.sessionKey, original.get(event)!.sessionKey);
    assert.ok((recovered.dataTimestamp as number) > (original.get(event)!.dataTimestamp as number));
  }
  assert.equal(setup.calls.length, 12);
  hub.dispose();
});

test('shared outage before any verified channels does not invent weather or race control samples', async () => {
  const setup = fixture();
  setup.breakStore();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'empty-outage' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe(frame => frames.push(frame));
  await hub.refresh(signal());
  assert.deepEqual(frames.map(frame => frame.event), ['session_state']);
  assert.equal(frames[0]!.data.delivery, 'unavailable');
  assert.equal(setup.calls.length, 0);
  hub.dispose();
});

test('lease loss immediately before publication cannot broadcast unfenced local success', async () => {
  const setup = fixture();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'old' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  setup.onPublish(() => setup.advance(LIVE_LEASE_MS + 1));
  await hub.refresh(signal());
  assert.equal(frames.some((frame) => frame.event === 'tower'), false);
  assert.equal(frames.at(-1)!.data.delivery, 'unavailable');
  assert.equal(setup.snapshot(), null);
  hub.dispose();
});

test('cancellation on a successful live claim reply retires the exact acquired lease without provider work', async () => {
  const setup = fixture();
  const caller = new AbortController();
  const originalClaim = setup.store.claim, originalRelease = setup.store.release;
  const releases: Array<{ owner: string; fence: number; aborted: boolean }> = [];
  setup.store.claim = async (...args) => { const claim = await originalClaim(...args); if (claim.owner) caller.abort(); return claim; };
  setup.store.release = async (owner, fence, signal) => { releases.push({ owner, fence, aborted: signal.aborted }); await originalRelease(owner, fence, signal); };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'claim-abort' }, { automatic: false });
  await hub.refresh(caller.signal);
  assert.deepEqual(releases, [{ owner: 'claim-abort_0', fence: 1, aborted: false }]);
  assert.equal(setup.lease()!.until - setup.now(), LIVE_REQUEST_GAP_MS);
  assert.equal(setup.calls.length, 0);
  assert.equal(hub.metrics().owner, false);
  hub.dispose();
  assert.equal(releases.length, 1);
});

test('cancellation on an admitted live start retires its own dispatch guard while preserving consumed quota', async () => {
  const setup = fixture();
  const caller = new AbortController(), originalReserve = setup.store.reserve;
  const completes: Array<{ owner: string; fence: number; aborted: boolean }> = [];
  setup.store.reserve = async (...args) => { const result = await originalReserve(...args); if (result.owned && result.retryMs === 0) caller.abort(); return result; };
  setup.store.complete = async (owner, fence, signal) => { completes.push({ owner, fence, aborted: signal.aborted }); };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'reserve-abort' }, { automatic: false });
  await hub.refresh(caller.signal);
  assert.deepEqual(completes, [{ owner: 'reserve-abort_0', fence: 1, aborted: false }]);
  assert.equal(setup.calls.length, 0);
  // The reservation remains spent: another attempt still waits the original
  // gap rather than receiving a manufactured quota refund.
  assert.deepEqual(await originalReserve('reserve-abort_0', 1, signal()), { owned: true, retryMs: LIVE_REQUEST_GAP_MS });
  hub.dispose();
});

test('a late claim reply from a departed generation cannot retain its lease or release a successor fence', async () => {
  const setup = fixture();
  const originalClaim = setup.store.claim;
  let releaseReply!: () => void;
  const replyGate = new Promise<void>(resolve => { releaseReply = resolve; });
  let first = true;
  setup.store.claim = async (...args) => {
    const result = await originalClaim(...args);
    if (first) { first = false; await replyGate; }
    return result;
  };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'late-claim' }, { automatic: false });
  const leave = hub.subscribe(() => {});
  const old = hub.refresh(signal());
  await new Promise<void>(resolve => setImmediate(resolve));
  leave(); setup.advance(LIVE_LEASE_MS + 1);
  const successor = await originalClaim('successor_0', signal());
  assert.equal(successor.owner, true);
  const successorLease = structuredClone(setup.lease());
  releaseReply(); await old;
  assert.deepEqual(setup.lease(), successorLease);
  assert.equal(setup.calls.length, 0);
  hub.dispose();
});

test('late old refresh and delayed release cannot clear or delete a reconnecting generation', async () => {
  const setup = fixture();
  let resolveOld: ((value: null) => void) | null = null;
  let delayedRelease: (() => Promise<void>) | null = null;
  const originalRelease = setup.store.release;
  setup.store.release = async (...args) => { delayedRelease = () => originalRelease(...args); };
  let first = true;
  const originalSession = setup.dependencies.source.getLatestSession;
  setup.dependencies.source.getLatestSession = async (options) => {
    if (first) { first = false; return new Promise<null>((resolve) => { resolveOld = resolve; }); }
    return originalSession(options);
  };
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'same' }, { automatic: false });
  const leave = hub.subscribe(() => {});
  const oldRefresh = hub.refresh(signal());
  await new Promise<void>((resolve) => setImmediate(resolve));
  leave();
  setup.advance(LIVE_LEASE_MS + 1);
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(signal());
  assert.equal(setup.lease()?.owner, 'same_1');
  const newFence = hub.metrics().fence;
  await (delayedRelease as (() => Promise<void>) | null)?.();
  (resolveOld as ((value: null) => void) | null)?.(null);
  await oldRefresh;
  assert.equal(hub.metrics().fence, newFence);
  assert.equal(setup.lease()?.owner, 'same_1');
  assert.equal(hub.metrics().subscribers, 1);
  assert.equal(frames.filter((frame) => frame.event === 'tower').at(-1)!.data.delivery, 'live');
  hub.dispose();
});

test('an old automatic loop rejecting after reconnect cannot overwrite its successor state', async () => {
  const setup = fixture();
  const originalSession = setup.dependencies.source.getLatestSession;
  setup.dependencies.source.getLatestSession = async (options) => ({ ...(await originalSession(options))!, date_start: new Date(START + 1_800_000).toISOString() });
  const ticks: Array<{ signal: AbortSignal; reject: (error: Error) => void }> = [];
  setup.dependencies.wait = (_ms, tickSignal) => new Promise<void>((_resolve, reject) => { ticks.push({ signal: tickSignal, reject }); });
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'automatic' });
  const firstLeave = hub.subscribe(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ticks.length, 1);
  firstLeave();
  setup.advance(LIVE_LEASE_MS + 1);
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(frames.filter((frame) => frame.event === 'session_state').at(-1)!.data.delivery, 'snapshot');
  ticks[0]!.reject(new Error('Late old aborted wait'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(hub.metrics().running, true);
  assert.equal(hub.metrics().owner, true);
  assert.equal(frames.filter((frame) => frame.event === 'session_state').at(-1)!.data.delivery, 'snapshot');
  hub.dispose();
  for (const tick of ticks) if (tick.signal.aborted) tick.reject(new Error('Disposed'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(hub.metrics().running, false);
});

test('a continuing owner moves from active to a different upcoming session without old-session channels', async () => {
  const setup = fixture();
  const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'transition' }, { automatic: false });
  const frames: LiveFrame[] = [];
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(signal());
  const originalFence = hub.metrics().fence;
  const original = setup.dependencies.source.getLatestSession;
  setup.dependencies.source.getLatestSession = async (options) => ({ ...(await original(options))!, session_key: 77, date_start: new Date(START + 1_800_000).toISOString() });
  await advanceOwned(setup, 'transition_0', 61_000);
  await hub.refresh(signal());
  assert.equal(hub.metrics().fence, originalFence);
  const state = frames.filter((frame) => frame.event === 'session_state').at(-1)!;
  assert.equal(state.data.session_key, 77);
  assert.equal(state.data.state, 'upcoming');
  assert.equal(state.data.delivery, 'snapshot');
  assert.deepEqual(setup.snapshot()!.frames.map((frame) => frame.event), ['session_state']);
  assert.equal(hub.metrics().retainedFrames, 1);
  hub.dispose();
});

test('same-session cancellation or disabled live access immediately replaces retained tower delivery', async () => {
  for (const cancelled of [false, true]) {
    const setup = fixture();
    let access = true;
    setup.dependencies.access = () => ({ realtimeConfigured: access });
    const hub = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'blocked' }, { automatic: false });
    const frames: LiveFrame[] = [];
    hub.subscribe((frame) => frames.push(frame));
    await hub.refresh(signal());
    const initialRequests = setup.calls.length;
    const original = setup.dependencies.source.getLatestSession;
    if (cancelled) setup.dependencies.source.getLatestSession = async (options) => ({ ...(await original(options))!, is_cancelled: true });
    else access = false;
    await advanceOwned(setup, 'blocked_0', 61_000);
    await hub.refresh(signal());
    assert.equal(setup.calls.length, initialRequests + 1);
    const tower = frames.filter((frame) => frame.event === 'tower').at(-1)!;
    assert.equal(tower.data.delivery, cancelled ? 'snapshot' : 'unavailable');
    assert.equal((tower.data.rows as unknown[]).length, 1);
    assert.equal(tower.data.stale, !cancelled);
    const state = frames.filter((frame) => frame.event === 'session_state').at(-1)!;
    assert.equal(state.data.cancelled, cancelled);
    assert.equal(state.data.delivery, cancelled ? 'snapshot' : 'unavailable');
    hub.dispose();
  }
});

test('confirmed absence removes a previously active session across owner and follower snapshots', async () => {
  const setup = fixture();
  const owner = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'absence-owner' }, { automatic: false });
  const follower = createDistributedLiveSessionHub({ ...setup.dependencies, store: setup.store, ownerId: 'absence-follower' }, { automatic: false });
  const ownerFrames: LiveFrame[] = [], followerFrames: LiveFrame[] = [];
  owner.subscribe((frame) => ownerFrames.push(frame)); follower.subscribe((frame) => followerFrames.push(frame));
  await owner.refresh(signal()); await follower.refresh(signal());
  assert.equal(setup.calls.length, 6);
  await advanceOwned(setup, 'absence-owner_0', 61_000);
  let lookups = 0;
  setup.dependencies.source.getLatestSession = async () => { lookups++; return null; };
  await owner.refresh(signal()); await follower.refresh(signal());
  assert.equal(lookups, 1); assert.equal(setup.calls.length, 6);
  assert.equal(setup.snapshot()!.frames.length, 1);
  for (const frames of [ownerFrames, followerFrames]) {
    const state = frames.filter((frame) => frame.event === 'session_state').at(-1)!.data;
    assert.equal(state.state, 'no_session'); assert.equal(state.delivery, 'snapshot');
    assert.equal(state.dataTimestamp, null); assert.equal(state.session_key, undefined);
  }
  assert.equal(owner.metrics().retainedFrames, 1); assert.equal(follower.metrics().retainedFrames, 1);
  owner.dispose(); follower.dispose();
});
