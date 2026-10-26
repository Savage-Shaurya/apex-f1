import 'next/dist/server/node-environment';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createMemoryLastGoodStore, openF1LastGoodKey, resetOpenF1LockoutMemo } from '@apex/api-client/openf1';
import { createOpenF1PageReader } from './openf1-shared-reader';
import type { OpenF1ReadStore } from './openf1-read-store';

// R3-BE-1 / R3-BE-5 / R3-BE-6: failure paths of the shared OpenF1 page reader,
// turned from the Round 3 repro scripts into fake-clock, fake-store tests.
const T0 = Date.parse('2026-10-25T14:00:00Z');
const positionRow = { session_key: 9999, meeting_key: 1, driver_number: 1, date: '2026-10-25T12:00:00Z', position: 1 };

afterEach(() => resetOpenF1LockoutMemo());

async function seededLastGood(clock: number) {
  const lastGoodStore = createMemoryLastGoodStore();
  const key = openF1LastGoodKey('position', { session_key: 9999 });
  await lastGoodStore.write({ version: 1, key, storedAt: clock - 3_600_000, rows: [positionRow] });
  return lastGoodStore;
}

function harness(admission: { retryMs: number; busy: boolean }, claim = { owner: true, fence: 1, retryMs: 0 }) {
  const state = { clock: T0, admits: 0, claims: 0, providerCalls: 0 };
  const store = {
    read: async () => null,
    claim: async () => { state.claims++; return claim; },
    admit: async () => { state.admits++; return admission; },
    publish: async () => null, release: async () => {}, complete: async () => {},
  } as unknown as OpenF1ReadStore;
  const fetchImpl = (async () => { state.providerCalls++; return new Response('{"detail":"Live F1 session in progress"}', { status: 401 }); }) as typeof fetch;
  return { state, store, fetchImpl };
}

test('R3-BE-1: a read queued on a busy admission until the page budget runs out serves the last-good copy', async () => {
  const { state, store, fetchImpl } = harness({ retryMs: 2300, busy: true });
  const reader = createOpenF1PageReader({ store, lastGoodStore: await seededLastGood(T0), now: () => state.clock, wait: async (ms) => { state.clock += ms; }, fetch: fetchImpl });
  const rows = await reader.getPositions(9999);
  assert.deepEqual(rows, [positionRow]);
  assert.equal(reader.freshness().stale, true);
  assert.equal(reader.freshness().reason, 'timeout');
  // The queue gives up early enough to leave time for the stored copy.
  assert.ok(state.clock - T0 <= 20_000 - 1_000, `queue stopped at ${state.clock - T0} ms`);
  assert.equal(state.providerCalls, 0);
});

test('R3-BE-1: a follower waiting on another owner until the budget runs out also serves the last-good copy', async () => {
  const { state, store, fetchImpl } = harness({ retryMs: 0, busy: false }, { owner: false, fence: 1, retryMs: 25_000 });
  const reader = createOpenF1PageReader({ store, lastGoodStore: await seededLastGood(T0), now: () => state.clock, wait: async (ms) => { state.clock += ms; }, fetch: fetchImpl });
  assert.deepEqual(await reader.getPositions(9999), [positionRow]);
  assert.equal(state.admits, 0);
});

test('R3-BE-1: while the live-session lockout memo is active no claim or admission is spent', async () => {
  const { state, store, fetchImpl } = harness({ retryMs: 0, busy: false });
  (globalThis as { __apexOpenF1LockedUntil?: number }).__apexOpenF1LockedUntil = Date.now() + 60_000;
  const reader = createOpenF1PageReader({ store, lastGoodStore: await seededLastGood(T0), now: () => state.clock, wait: async (ms) => { state.clock += ms; }, fetch: fetchImpl });
  assert.deepEqual(await reader.getPositions(9999), [positionRow]);
  assert.equal(state.admits, 0);
  assert.equal(state.claims, 0);
  assert.equal(state.providerCalls, 0);
  assert.equal(reader.freshness().reason, 'live-session-lockout');
});

test('R3-BE-1: with no stored copy the budget-exhausted read still fails truthfully', async () => {
  const { state, store, fetchImpl } = harness({ retryMs: 2300, busy: true });
  const reader = createOpenF1PageReader({ store, lastGoodStore: createMemoryLastGoodStore(), now: () => state.clock, wait: async (ms) => { state.clock += ms; }, fetch: fetchImpl });
  await assert.rejects(reader.getPositions(9999));
});

test('R3-BE-5: a cached entry a few ms past its TTL (clock skew) is a miss, not a failed read', async () => {
  let clock = T0, providerCalls = 0;
  const locationRow = { session_key: 9999, meeting_key: 1, driver_number: 1, date: '2026-10-25T13:59:50Z', x: 1, y: 2, z: 3 };
  const store = {
    read: async (query: string) => ({ version: 1, query, writtenAt: clock - 10_050, rows: [locationRow] }),
    claim: async () => ({ owner: true, fence: 1, retryMs: 0 }), admit: async () => ({ retryMs: 0, busy: false }),
    publish: async (query: string, _owner: string, _fence: number, rows: unknown[]) => ({ version: 1, query, writtenAt: clock, rows }),
    release: async () => {}, complete: async () => {},
  } as unknown as OpenF1ReadStore;
  const reader = createOpenF1PageReader({ store, lastGoodStore: null, now: () => clock, wait: async (ms) => { clock += ms; },
    fetch: (async () => { providerCalls++; return Response.json([locationRow]); }) as typeof fetch });
  assert.deepEqual(await reader.getLocation(9999, { dateGte: '2026-10-25T13:55:00Z', dateLte: '2026-10-25T14:00:00Z' }), [locationRow]);
  assert.equal(providerCalls, 1);
});

test('R3-BE-5: an entry dated far in the future is still rejected as corrupt', async () => {
  const clock = T0;
  const store = {
    read: async (query: string) => ({ version: 1, query, writtenAt: clock + 60_000, rows: [] }),
    claim: async () => ({ owner: true, fence: 1, retryMs: 0 }), admit: async () => ({ retryMs: 0, busy: false }),
    publish: async () => null, release: async () => {}, complete: async () => {},
  } as unknown as OpenF1ReadStore;
  const reader = createOpenF1PageReader({ store, lastGoodStore: null, now: () => clock, wait: async () => {}, fetch: (async () => Response.json([])) as typeof fetch });
  await assert.rejects(reader.getLocation(9999, { dateGte: '2026-10-25T13:55:00Z', dateLte: '2026-10-25T14:00:00Z' }), (error: Error & { code?: string }) => error.code === 'incomplete');
});
