import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { createLiveSessionHub, waitForLiveTick, type LiveFetchOptions, type LiveFrame } from './live-session-hub';
import type { OpenF1Session } from '@apex/api-client/openf1';

type Source = Parameters<typeof createLiveSessionHub>[0]['source'];
const START = Date.parse('2026-09-27T12:00:00Z');

function fixture(access = true) {
  let clock = START + 60_000;
  let key = 42;
  let failPositions = false;
  const calls: Array<{ name: string; at: number; options: LiveFetchOptions }> = [];
  const sample = () => new Date(START + 59_000).toISOString();
  const session = (): OpenF1Session => ({
    session_key: key, session_type: 'Race', session_name: 'Race', date_start: new Date(START).toISOString(),
    date_end: new Date(START + 2 * 60 * 60_000).toISOString(), meeting_key: 1, circuit_key: 1,
    circuit_short_name: 'Test', country_code: 'TST', country_name: 'Test', location: 'Test', gmt_offset: '+00:00', year: 2026,
  });
  const record = (name: string, options: LiveFetchOptions) => { calls.push({ name, at: clock, options }); };
  const source: Source = {
    async getLatestSession(options) { record('session', options); return session(); },
    async getDrivers(_key, options) {
      record('drivers', options);
      return [{ session_key: key, driver_number: key === 42 ? 4 : 16, full_name: 'Real Driver', name_acronym: 'REA', team_name: 'Real Team', team_colour: 'FF8000', country_code: 'TST' }];
    },
    async getPositions(_key, options) {
      record('positions', options);
      if (failPositions) throw new Error('offline failure');
      return [{ session_key: key, driver_number: key === 42 ? 4 : 16, position: 1, date: sample() }];
    },
    async getIntervals(_key, options) {
      record('intervals', options);
      return [{ session_key: key, driver_number: key === 42 ? 4 : 16, gap_to_leader: 0, interval: '+1 LAP', date: sample() }];
    },
    async getRaceControl(_key, options) {
      record('race_control', options);
      return [{ session_key: key, date: sample(), category: 'Flag', message: 'GREEN LIGHT - PIT EXIT OPEN' }];
    },
    async getWeather(_key, options) {
      record('weather', options);
      return [{ session_key: key, date: sample(), air_temperature: 24, track_temperature: 31, rainfall: 0 }];
    },
  };
  const dependencies = {
    source, access: () => ({ realtimeConfigured: access }), now: () => clock,
    wait: async (milliseconds: number, signal: AbortSignal) => { signal.throwIfAborted(); clock += milliseconds; },
  };
  return {
    source, dependencies, calls, now: () => clock,
    advance: (milliseconds: number) => { clock += milliseconds; },
    changeSession: () => { key = 77; }, failPositions: () => { failPositions = true; },
  };
}

test('twenty viewers and concurrent refreshes share six initial upstream requests', async () => {
  const setup = fixture();
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  const captures = Array.from({ length: 20 }, () => [] as LiveFrame[]);
  const unsubscribers = captures.map((frames) => hub.subscribe((frame) => frames.push(frame)));
  await Promise.all(captures.map(() => hub.refresh(new AbortController().signal)));
  assert.equal(setup.calls.length, 6);
  assert.equal(hub.metrics().subscribers, 20);
  for (const frames of captures) assert.ok(frames.some((frame) => frame.event === 'tower'));
  for (const unsubscribe of unsubscribers) { unsubscribe(); unsubscribe(); }
  assert.equal(hub.metrics().subscribers, 0);
  assert.equal(hub.metrics().running, false);
});

test('channel publication is awaited after applying original rows and before the next source request', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const reads: Array<{ channel: string; data: unknown; start: number; end: number }> = [];
  let releasePosition!: () => void;
  const positionPublication = new Promise<void>(resolve => { releasePosition = resolve; });
  const hub = createLiveSessionHub({ ...setup.dependencies, onChannelSettled: async (read, signal) => {
    signal.throwIfAborted();
    reads.push({ channel: read.channel, data: read.data, start: read.acquisitionStartedAt, end: read.acquisitionCompletedAt });
    if (read.channel === 'positions') {
      const tower = frames.filter(frame => frame.event === 'tower').at(-1)!;
      assert.equal(tower.data.dataTimestamp, START + 59_000);
      assert.equal((tower.data.rows as Array<{ pos: number }>)[0]!.pos, 1);
      await positionPublication;
    }
  } }, { automatic: false, requestGapMs: 0 });
  hub.subscribe(frame => frames.push(frame));
  const refresh = hub.refresh(new AbortController().signal);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(setup.calls.map(value => value.name), ['session', 'drivers', 'positions']);
  assert.deepEqual(reads.map(value => value.channel), ['session', 'drivers', 'positions']);
  assert.equal((reads[2]!.data as Array<{ date: string }>)[0]!.date, new Date(START + 59_000).toISOString());
  assert.ok(reads.every(value => value.start <= value.end && value.end === setup.now()));
  releasePosition(); await refresh;
  assert.equal(setup.calls.length, 6);
  assert.equal(reads.length, 6);
  hub.dispose();
});

test('a failed durable channel publication stops subsequent provider reads', async () => {
  const setup = fixture();
  const hub = createLiveSessionHub({ ...setup.dependencies, onChannelSettled: async read => {
    if (read.channel === 'positions') throw new Error('Publication fence lost');
  } }, { automatic: false, requestGapMs: 0 });
  await assert.rejects(hub.refresh(new AbortController().signal), /Publication fence lost/);
  assert.deepEqual(setup.calls.map(value => value.name), ['session', 'drivers', 'positions']);
  hub.dispose();
});

test('timing requests use twelve-second source cadence without changing original sample age', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe(frame => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  setup.advance(6_000); await hub.refresh(new AbortController().signal);
  assert.equal(setup.calls.filter(value => value.name === 'positions').length, 1);
  assert.equal(setup.calls.filter(value => value.name === 'intervals').length, 1);
  setup.advance(6_000); await hub.refresh(new AbortController().signal);
  assert.equal(setup.calls.filter(value => value.name === 'positions').length, 2);
  assert.equal(setup.calls.filter(value => value.name === 'intervals').length, 2);
  assert.equal(frames.filter(frame => frame.event === 'tower').at(-1)!.data.dataTimestamp, START + 59_000);
  hub.dispose();
});

test('telemetry uses bounded date filters, strict errors, cancellation and no Next data cache', async () => {
  const setup = fixture();
  const signal = new AbortController().signal;
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  await hub.refresh(signal);
  for (const call of setup.calls) {
    assert.equal(call.options.signal, signal);
    assert.equal(call.options.strict, true);
    assert.equal(call.options.revalidate, 0);
    assert.equal(call.options.timeoutMs, 8_000);
    if (call.name === 'positions' || call.name === 'intervals' || call.name === 'weather') {
      const span = Date.parse(call.options.dateLte!) - Date.parse(call.options.dateGte!);
      assert.ok(span >= 0 && span <= 120_000);
    }
    if (call.name === 'race_control') {
      assert.ok(Date.parse(call.options.dateLte!) - Date.parse(call.options.dateGte!) <= 1_800_000);
    }
  }
});

test('maps gap_to_leader including zero and preserves actual sample age and real driver metadata', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  const tower = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.deepEqual(tower.data.rows, [{ driver: 4, pos: 1, gap: 0, interval: '+1 LAP', full_name: 'Real Driver', name_acronym: 'REA', team_name: 'Real Team', team_colour: 'FF8000' }]);
  assert.equal(tower.data.dataTimestamp, START + 59_000);
  assert.equal(tower.data.lastDataAt, START + 59_000);
  assert.equal(tower.data.ts, START + 60_000);
  assert.equal(tower.data.status, 'live');
  hub.dispose();
});

test('unchanged upstream samples do not emit duplicate tower frames or manufacture freshness', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  const initialCount = frames.filter((frame) => frame.event === 'tower').length;
  setup.advance(7_000);
  await hub.refresh(new AbortController().signal);
  assert.equal(frames.filter((frame) => frame.event === 'tower').length, initialCount);
  setup.advance(31_000);
  await hub.refresh(new AbortController().signal);
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal(last.data.dataTimestamp, START + 59_000);
  assert.equal(last.data.status, 'stale');
  hub.dispose();
});

test('a real driver without a recent position remains visible with an unknown position', async () => {
  const setup = fixture();
  setup.source.getPositions = async () => [];
  setup.source.getIntervals = async () => [];
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  const row = (last.data.rows as Array<{ driver: number; pos: number | null }>)[0]!;
  assert.equal(row.driver, 4);
  assert.equal(row.pos, null);
  assert.equal(last.data.dataTimestamp, null);
  assert.equal(last.data.status, 'stale');
  hub.dispose();
});

test('sparse positions bootstrap only once and later polling remains bounded to a two-minute overlap', async () => {
  const setup = fixture();
  setup.advance(10 * 60_000);
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  await hub.refresh(new AbortController().signal);
  const first = setup.calls.find((call) => call.name === 'positions')!;
  assert.equal(Date.parse(first.options.dateGte!), START);
  assert.ok(Date.parse(first.options.dateLte!) - Date.parse(first.options.dateGte!) > 120_000);
  setup.advance(13_000);
  await hub.refresh(new AbortController().signal);
  const last = setup.calls.filter((call) => call.name === 'positions').at(-1)!;
  assert.ok(Date.parse(last.options.dateLte!) - Date.parse(last.options.dateGte!) <= 120_000);
  hub.dispose();
});

test('out-of-order provider history cannot overwrite a newer known position', async () => {
  const setup = fixture();
  setup.source.getPositions = async () => [
    { session_key: 42, driver_number: 4, position: 1, date: new Date(START + 59_000).toISOString() },
    { session_key: 42, driver_number: 4, position: 9, date: new Date(START + 20_000).toISOString() },
  ];
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal((last.data.rows as Array<{ pos: number }>)[0]!.pos, 1);
  hub.dispose();
});

test('upstream failure retains known rows and marks them stale rather than wiping to empty success', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  setup.advance(13_000);
  setup.failPositions();
  await hub.refresh(new AbortController().signal);
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal((last.data.rows as Array<{ driver: number }>)[0]!.driver, 4);
  assert.equal(last.data.stale, true);
  assert.equal(last.data.status, 'stale');
  assert.equal(last.data.dataTimestamp, START + 59_000);
  hub.dispose();
});

test('unconfigured live access emits unavailable state without anonymous telemetry polling', async () => {
  const setup = fixture(false);
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  assert.deepEqual(setup.calls.map((call) => call.name), ['session']);
  const state = frames.filter((frame) => frame.event === 'session_state').at(-1)!;
  assert.equal(state.data.state, 'live');
  assert.equal(state.data.delivery, 'unavailable');
  assert.equal(state.data.realtimeAvailable, false);
  assert.equal(state.data.dataTimestamp, null);
  hub.dispose();
});

test('completed session is a cached snapshot and reconnecting viewers do not repeat telemetry requests', async () => {
  const setup = fixture(false);
  setup.advance(3 * 60 * 60_000);
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  const first = hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  const originalRequests = setup.calls.length;
  first();
  for (let index = 0; index < 20; index += 1) hub.subscribe(() => {})();
  assert.equal(setup.calls.length, originalRequests);
  setup.advance(61_000);
  await hub.refresh(new AbortController().signal);
  assert.equal(setup.calls.length, originalRequests + 1);
  assert.equal(setup.calls.at(-1)!.name, 'session');
  assert.equal(frames.filter((frame) => frame.event === 'tower').at(-1)!.data.status, 'snapshot');
  hub.dispose();
});

test('session changes clear previous-session rows and reseed metadata', async () => {
  const setup = fixture();
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  setup.advance(61_000); setup.changeSession();
  await hub.refresh(new AbortController().signal);
  const last = frames.filter((frame) => frame.event === 'tower').at(-1)!;
  assert.equal(last.data.sessionKey, 77);
  assert.deepEqual((last.data.rows as Array<{ driver: number }>).map((row) => row.driver), [16]);
  assert.equal(frames.filter((frame) => frame.event === 'session_state').at(-1)!.data.session_key, 77);
  hub.dispose();
});

test('production pace stays below the free rate budget across shared refresh work', async () => {
  const setup = fixture();
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false });
  const signal = new AbortController().signal;
  for (let index = 0; index < 100; index += 1) { await hub.refresh(signal); setup.advance(1_000); }
  assert.ok(setup.calls.length > 26);
  for (let index = 1; index < setup.calls.length; index += 1) assert.ok(setup.calls[index]!.at - setup.calls[index - 1]!.at >= 2_300);
  for (const call of setup.calls) assert.ok(setup.calls.filter((other) => other.at > call.at - 60_000 && other.at <= call.at).length <= 26);
  assert.equal(hub.metrics().upstreamRequests, setup.calls.length);
  hub.dispose();
});

test('last viewer departure aborts shared upstream work; earlier departure leaves other viewer active', async () => {
  const setup = fixture();
  let receivedSignal: AbortSignal | null = null;
  setup.source.getLatestSession = (options) => new Promise((_resolve, reject) => {
    receivedSignal = options.signal;
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const hub = createLiveSessionHub({ ...setup.dependencies, wait: waitForLiveTick });
  const first = hub.subscribe(() => {});
  const second = hub.subscribe(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  first();
  assert.equal((receivedSignal as AbortSignal | null)?.aborted, false);
  second();
  assert.equal((receivedSignal as AbortSignal | null)?.aborted, true);
  assert.deepEqual({ subscribers: hub.metrics().subscribers, running: hub.metrics().running }, { subscribers: 0, running: false });
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test('normal tick sleeps release abort listeners, and abort promptly resolves a pending sleep', async () => {
  const controller = new AbortController();
  for (let index = 0; index < 20; index += 1) await waitForLiveTick(0, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const pending = waitForLiveTick(60_000, controller.signal);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort();
  await pending;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('aborted first session request does not suppress the next cold reconnect for sixty seconds', async () => {
  const setup = fixture();
  const first = new AbortController();
  const original = setup.source.getLatestSession;
  let calls = 0;
  setup.source.getLatestSession = async (options) => {
    calls += 1;
    if (calls === 1) { first.abort(); options.signal.throwIfAborted(); }
    return original(options);
  };
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  await assert.rejects(hub.refresh(first.signal));
  await hub.refresh(new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(setup.calls.filter((call) => call.name === 'positions').length, 1);
  hub.dispose();
});

test('failed and aborted sparse-position bootstrap retains the full initial retry window', async () => {
  for (const abortFirst of [false, true]) {
    const setup = fixture(); setup.advance(10 * 60_000);
    const controller = new AbortController();
    const original = setup.source.getPositions;
    let attempts = 0;
    setup.source.getPositions = async (key, options) => {
      attempts += 1;
      if (attempts === 1) {
        setup.calls.push({ name: 'failed-position', at: setup.now(), options });
        if (abortFirst) controller.abort();
        throw new Error('Interrupted first bootstrap');
      }
      return original(key, options);
    };
    const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
    if (abortFirst) await assert.rejects(hub.refresh(controller.signal)); else await hub.refresh(controller.signal);
    setup.advance(61_000);
    await hub.refresh(new AbortController().signal);
    const retry = setup.calls.filter((call) => call.name === 'positions').at(-1)!;
    assert.equal(Date.parse(retry.options.dateGte!), START);
    assert.ok(Date.parse(retry.options.dateLte!) - Date.parse(retry.options.dateGte!) > 120_000);
    hub.dispose();
  }
});

test('foreign-session provider rows are never relabelled into a current tower, message or weather frame', async () => {
  const setup = fixture();
  setup.source.getDrivers = async () => [{ session_key: 99, driver_number: 16, full_name: 'Wrong Driver', name_acronym: 'BAD', team_name: 'Wrong Team', team_colour: 'FF0000', country_code: 'TST' }];
  setup.source.getPositions = async () => [{ session_key: 99, driver_number: 16, position: 1, date: new Date(START + 59_000).toISOString() }];
  setup.source.getIntervals = async () => [{ session_key: 99, driver_number: 16, gap_to_leader: 0, date: new Date(START + 59_000).toISOString() }];
  setup.source.getRaceControl = async () => [{ session_key: 99, category: 'Flag', message: 'WRONG SESSION', date: new Date(START + 59_000).toISOString() }];
  setup.source.getWeather = async () => [{ session_key: 99, air_temperature: 100, date: new Date(START + 59_000).toISOString() }];
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  assert.equal(frames.some((frame) => frame.event === 'tower' || frame.event === 'weather'), false);
  assert.deepEqual(frames.find((frame) => frame.event === 'race_control')!.data.messages, []);
  assert.equal(frames.filter((frame) => frame.event === 'session_state').at(-1)!.data.dataTimestamp, null);
  hub.dispose();
});

test('cancelled sessions expose the explicit cancellation flag and never request telemetry', async () => {
  const setup = fixture();
  const original = setup.source.getLatestSession;
  setup.source.getLatestSession = async (options) => ({ ...(await original(options))!, is_cancelled: true });
  const frames: LiveFrame[] = [];
  const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
  hub.subscribe((frame) => frames.push(frame));
  await hub.refresh(new AbortController().signal);
  assert.deepEqual(setup.calls.map((call) => call.name), ['session']);
  assert.equal(frames.at(-1)!.data.cancelled, true);
  assert.match(frames.at(-1)!.data.detail as string, /cancelled/);
  hub.dispose();
});

test('a strict successful null confirms no session while failure and invalid data remain unavailable', async () => {
  for (const outcome of ['empty', 'failure', 'invalid'] as const) {
    const setup = fixture();
    setup.source.getLatestSession = async (options) => {
      setup.calls.push({ name: 'session', at: setup.now(), options });
      if (outcome === 'failure') throw new Error('Fixture source failure');
      return outcome === 'empty' ? null : { session_key: 0 } as OpenF1Session;
    };
    const hub = createLiveSessionHub(setup.dependencies, { automatic: false, requestGapMs: 0 });
    const frames: LiveFrame[] = []; hub.subscribe((frame) => frames.push(frame));
    await hub.refresh(new AbortController().signal);
    const state = frames.filter((frame) => frame.event === 'session_state').at(-1)!.data;
    assert.equal(state.state, 'no_session');
    assert.equal(state.delivery, outcome === 'empty' ? 'snapshot' : 'unavailable');
    assert.equal(state.status, state.delivery); assert.equal(state.dataTimestamp, null);
    if (outcome === 'empty') assert.equal(state.detail, 'No session is currently scheduled or active.');
    assert.deepEqual(setup.calls.map((call) => call.name), ['session']);
    assert.equal(hub.metrics().retainedFrames, 1); hub.dispose();
  }
});
