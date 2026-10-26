import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openf1 } from './index';

// R3-CODE-1 / R3-CODE-2: one OpenF1 client for finished-session history.
const rt = { position: 'RT', driver_number: 6, number_of_laps: 3, dnf: false, dns: false, dsq: false, duration: [null, null, null], gap_to_leader: [null, null, null], meeting_key: 1296, session_key: 11384 };
const p1 = { position: 1, driver_number: 3, number_of_laps: 15, dnf: false, dns: false, dsq: false, duration: [93.241, 91.639, 91.373], gap_to_leader: [0.812, 0.11, 0], meeting_key: 1296, session_key: 11384 };
const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

test('R3-CODE-1: a coded position (real Singapore qualifying row, "RT") is read, normalised to position null + position_code', async () => {
  const rows = await openf1.getSessionResult(11384, { strict: true, fetchImpl: respond([p1, rt]) });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.position, 1);
  assert.equal(rows[1]!.position, null);
  assert.equal(rows[1]!.position_code, 'RT');
});

test('R3-CODE-1: a free-text position is still rejected as an invalid response', async () => {
  await assert.rejects(openf1.getSessionResult(11384, { strict: true, fetchImpl: respond([{ ...rt, position: 'retired, see notes' }]) }), (error: Error & { code?: string }) => error.code === 'invalid-response');
});

test('R3-CODE-2: starting grid and meeting reads go through the shared client and are identity-checked', async () => {
  const grid = await openf1.getStartingGrid(11384, { strict: true, fetchImpl: respond([{ session_key: 11384, meeting_key: 1296, driver_number: 3, position: 1, lap_duration: 91.373 }]) });
  assert.equal(grid[0]!.position, 1);
  await assert.rejects(openf1.getStartingGrid(11384, { strict: true, fetchImpl: respond([{ session_key: 99, driver_number: 3, position: 1, lap_duration: null }]) }));
  const meeting = await openf1.getMeeting(1296, { strict: true, fetchImpl: respond([{ meeting_key: 1296, meeting_name: 'Singapore Grand Prix', date_start: '2026-10-02T09:30:00+00:00' }]) });
  assert.equal(meeting?.meeting_name, 'Singapore Grand Prix');
  assert.equal(await openf1.getMeeting(1296, { strict: true, fetchImpl: respond({ detail: 'No results found.' }, 404) }), null);
});

test('R3-CODE-8: "as of" is when OpenF1 produced the response (Date header), not when a cached copy was read', async () => {
  const { createMemoryLastGoodStore } = await import('./last-good');
  const produced = Date.now() - 3 * 3_600_000;
  const seen: number[] = [];
  const fetchImpl = (async () => new Response(JSON.stringify([p1]), { status: 200, headers: { 'content-type': 'application/json', date: new Date(produced).toUTCString() } })) as typeof fetch;
  await openf1.getSessionResult(11384, { strict: true, fetchImpl, lastGoodStore: createMemoryLastGoodStore(), onProvenance: (p) => seen.push(p.asOf) });
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0]! - produced) < 1_000, `asOf ${seen[0]} vs produced ${produced}`);
  // A future Date (clock skew) never makes data look newer than the read.
  const future = (async () => new Response(JSON.stringify([p1]), { status: 200, headers: { date: new Date(Date.now() + 3_600_000).toUTCString() } })) as typeof fetch;
  const before = Date.now();
  await openf1.getSessionResult(11384, { strict: true, fetchImpl: future, lastGoodStore: null, onProvenance: (p) => seen.push(p.asOf) });
  assert.ok(seen[1]! >= before && seen[1]! <= Date.now());
});

test('R3-CODE-8: unchanged rows are not rewritten to the shared store on every read', async () => {
  const { createLayeredLastGoodStore, createMemoryLastGoodStore } = await import('./last-good');
  let sharedWrites = 0;
  const shared = { read: async () => null, write: async () => { sharedWrites++; } };
  const store = createLayeredLastGoodStore([createMemoryLastGoodStore(), shared]);
  await store.write({ version: 1, key: 'k', storedAt: 1, rows: [p1] });
  await store.write({ version: 1, key: 'k', storedAt: 2, rows: [p1] });
  assert.equal(sharedWrites, 1);
  await store.write({ version: 1, key: 'k', storedAt: 3, rows: [p1, rt] });
  assert.equal(sharedWrites, 2);
  assert.equal((await store.read('k'))!.storedAt, 3);
});

test('R3-CODE-8: the last-good write is handed to the caller\'s after() instead of being left dangling', async () => {
  const { createMemoryLastGoodStore, openF1LastGoodKey } = await import('./last-good');
  const store = createMemoryLastGoodStore();
  const deferred: Array<() => Promise<void>> = [];
  await openf1.getSessionResult(11384, { strict: true, fetchImpl: respond([p1]), lastGoodStore: store, deferWrite: (task) => { deferred.push(task); } });
  const key = openF1LastGoodKey('session_result', { session_key: 11384 });
  assert.equal(deferred.length, 1);
  assert.equal(await store.read(key), null, 'nothing written before the deferred task runs');
  await deferred[0]!();
  assert.equal((await store.read(key))?.rows.length, 1);
});
