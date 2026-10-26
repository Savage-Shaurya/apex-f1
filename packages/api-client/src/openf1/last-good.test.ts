import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../transport';
import { openf1, OpenF1LiveSessionLockout, createMemoryLastGoodStore, createRedisLastGoodStore, openF1LastGoodKey, resetOpenF1LockoutMemo, type OpenF1Provenance } from './index';

const session = { session_key: 11392, meeting_key: 1297, session_name: 'Qualifying', session_type: 'Qualifying', date_start: '2026-10-24T21:00:00+00:00', date_end: '2026-10-24T22:00:00+00:00', circuit_key: 9, circuit_short_name: 'Austin', country_code: 'USA', country_name: 'United States', location: 'Austin', gmt_offset: '-05:00:00', year: 2026, is_cancelled: false };
const LOCKOUT_BODY = JSON.stringify({ detail: 'Live F1 session in progress. Global API access (including past sessions) is restricted to authenticated users until the session ends.' });
const lockout = async () => new Response(LOCKOUT_BODY, { status: 401, headers: { 'content-type': 'application/json' } });

test('a live-session 401 is recognised as the OpenF1 lockout, not a generic failure', async () => {
  await assert.rejects(openf1.getLatestSession({ strict: true, fetchImpl: lockout, lastGoodStore: null }), (error) => error instanceof OpenF1LiveSessionLockout && error instanceof ProviderError && error.status === 401);
  await assert.rejects(openf1.getLatestSession({ strict: true, fetchImpl: async () => new Response('{"detail":"bad token"}', { status: 401 }), lastGoodStore: null }), (error) => error instanceof ProviderError && !(error instanceof OpenF1LiveSessionLockout));
});

test('the last good response is served during the lockout with its real fetch time', async () => {
  resetOpenF1LockoutMemo();
  const store = createMemoryLastGoodStore();
  const seen: OpenF1Provenance[] = [];
  const onProvenance = (provenance: OpenF1Provenance) => seen.push(provenance);
  const before = Date.now();
  const live = await openf1.getLatestSession({ strict: true, fetchImpl: async () => Response.json([session]), lastGoodStore: store, onProvenance });
  assert.equal(live?.session_key, 11392);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen[0]!.source, 'provider');
  // Without opting in, a refusal is still a refusal.
  await assert.rejects(openf1.getLatestSession({ strict: true, fetchImpl: lockout, lastGoodStore: store }), OpenF1LiveSessionLockout);
  const stored = await openf1.getLatestSession({ strict: true, fetchImpl: lockout, lastGoodStore: store, lastGood: 'fallback', onProvenance });
  assert.deepEqual(stored, session);
  const last = seen.at(-1)!;
  assert.equal(last.source, 'last-good');
  assert.equal(last.reason, 'live-session-lockout');
  assert.ok(last.asOf >= before && last.asOf <= Date.now());
  // 'only' never touches the network.
  let calls = 0;
  assert.deepEqual(await openf1.getLatestSession({ strict: true, fetchImpl: async () => { calls++; return Response.json([]); }, lastGoodStore: store, lastGood: 'only' }), session);
  assert.equal(calls, 0);
});

test('snapshots are per query and still pass identity validation', async () => {
  const store = createMemoryLastGoodStore();
  await openf1.getWeather(11392, { strict: true, fetchImpl: async () => Response.json([{ session_key: 11392, meeting_key: 1297, date: '2026-10-24T21:10:00+00:00', track_temperature: 31.2 }]), lastGoodStore: store });
  await new Promise((resolve) => setImmediate(resolve));
  // A different session has no snapshot: the failure stands.
  await assert.rejects(openf1.getWeather(11396, { strict: true, fetchImpl: lockout, lastGoodStore: store, lastGood: 'fallback' }), OpenF1LiveSessionLockout);
  // A tampered snapshot holding another session's rows is refused.
  const key = openF1LastGoodKey('weather', { session_key: 11396 });
  await store.write({ version: 1, key, storedAt: Date.now(), rows: [{ session_key: 11392, date: '2026-10-24T21:10:00+00:00' }] });
  await assert.rejects(openf1.getWeather(11396, { strict: true, fetchImpl: lockout, lastGoodStore: store, lastGood: 'fallback' }), OpenF1LiveSessionLockout);
  // Non-strict callers still get the honest empty fallback.
  assert.deepEqual(await openf1.getWeather(11396, { fetchImpl: lockout, lastGoodStore: store, lastGood: 'fallback' }), []);
});

test('an older observation never replaces a newer snapshot', async () => {
  const store = createMemoryLastGoodStore();
  const key = openF1LastGoodKey('sessions', { session_key: 'latest' });
  await store.write({ version: 1, key, storedAt: 2000, rows: [{ n: 2 }] });
  await store.write({ version: 1, key, storedAt: 1000, rows: [{ n: 1 }] });
  assert.equal((await store.read(key))?.storedAt, 2000);
});

test('the Redis snapshot store uses bounded GET/SET EX commands and reads failures as a miss', async () => {
  const commands: unknown[][] = [];
  const values = new Map<string, string>();
  const store = createRedisLastGoodStore({ url: 'https://fixture.upstash.io', token: 'fixture-token' }, {
    // The production deployment's keys (other environments are scoped, redis-scope-keys.test.ts).
    env: { VERCEL_ENV: 'production' },
    fetch: async (_url, init) => {
      const command = JSON.parse(String(init?.body)) as string[];
      commands.push(command);
      if (command[0] === 'SET') { values.set(command[1]!, command[2]!); return Response.json({ result: 'OK' }); }
      return Response.json({ result: values.get(command[1]!) ?? null });
    },
  });
  const key = openF1LastGoodKey('drivers', { session_key: 11392 });
  await store.write({ version: 1, key, storedAt: 5, rows: [{ driver_number: 1 }] });
  assert.deepEqual((await store.read(key))?.rows, [{ driver_number: 1 }]);
  assert.equal(commands[0]![0], 'SET');
  assert.equal(commands[0]![3], 'EX');
  assert.ok(String(commands[0]![1]).startsWith('apex:openf1:v1:last-good:'));
  const broken = createRedisLastGoodStore({ url: 'https://fixture.upstash.io', token: 'fixture-token' }, { fetch: async () => new Response('nope', { status: 500 }) });
  assert.equal(await broken.read(key), null);
});

test('OpenF1 "No results found." 404 is confirmed empty data; other 404s stay failures', async () => {
  const empty = async () => new Response('{"detail":"No results found."}', { status: 404 });
  assert.deepEqual(await openf1.getIntervals(11396, { strict: true, fetchImpl: empty, lastGoodStore: null }), []);
  await assert.rejects(openf1.getIntervals(11396, { strict: true, fetchImpl: async () => new Response('<html>Not Found</html>', { status: 404 }), lastGoodStore: null }), ProviderError);
});
