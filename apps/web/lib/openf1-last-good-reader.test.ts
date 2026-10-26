import 'next/dist/server/node-environment';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryLastGoodStore, resetOpenF1LockoutMemo } from '@apex/api-client/openf1';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { createOpenF1PageReader, summariseOpenF1Freshness } from './openf1-shared-reader';
import type { OpenF1ReadStore } from './openf1-read-store';

const session = { session_key: 11392, meeting_key: 1297, session_name: 'Qualifying', session_type: 'Qualifying', date_start: '2026-10-24T21:00:00+00:00', date_end: '2026-10-24T22:00:00+00:00', circuit_key: 9, circuit_short_name: 'Austin', country_code: 'USA', country_name: 'United States', location: 'Austin', gmt_offset: '-05:00:00', year: 2026 };
const lockout: typeof fetch = async () => new Response(JSON.stringify({ detail: 'Live F1 session in progress. Global API access (including past sessions) is restricted to authenticated users until the session ends.' }), { status: 401 });

test('direct (no shared store) reads keep working through the live-session lockout and say how old the data is', async () => {
  resetOpenF1LockoutMemo();
  const lastGoodStore = createMemoryLastGoodStore();
  const first = createOpenF1PageReader({ store: null, direct: true, lastGoodStore, fetch: async () => Response.json([session]) });
  assert.equal((await first.getLatestSession())?.session_key, 11392);
  assert.deepEqual(first.freshness(), { stale: false, asOf: null, reason: null });
  await new Promise((resolve) => setImmediate(resolve));
  const during = createOpenF1PageReader({ store: null, direct: true, lastGoodStore, fetch: lockout });
  assert.equal((await during.getLatestSession())?.session_key, 11392);
  const freshness = during.freshness();
  assert.equal(freshness.stale, true);
  assert.equal(freshness.reason, 'live-session-lockout');
  assert.ok(freshness.asOf && freshness.asOf <= Date.now());
  // Nothing stored for this query: the honest unavailable state remains.
  await assert.rejects(during.getDrivers(11392), (error: unknown) => error instanceof ProviderError);
});

test('without a store and without direct mode the reader still fails closed with a configuration reason', async () => {
  await assert.rejects(createOpenF1PageReader({ store: null }).getLatestSession(), (error: unknown) => error instanceof ProviderError && error.code === 'configuration');
});

test('shared-store reads fall back to the last good snapshot after a provider refusal and never republish it', async () => {
  const published: unknown[] = [];
  const store: OpenF1ReadStore = {
    async read() { return null; },
    async claim() { return { owner: true, fence: 1, retryMs: 0 }; },
    async admit() { return { retryMs: 0, busy: false }; },
    async publish(query, _owner, _fence, rows) { published.push(rows); return { version: 1, query, writtenAt: Date.now(), rows }; },
    async release() {},
    async complete() {},
  };
  const lastGoodStore = createMemoryLastGoodStore();
  const rows = [{ session_key: 11392, meeting_key: 1297, date: '2026-10-24T21:59:00+00:00', category: 'Flag', message: 'CHEQUERED FLAG' }];
  const ok = createOpenF1PageReader({ store, lastGoodStore, fetch: async () => Response.json(rows) });
  assert.equal((await ok.getRaceControl(11392)).length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  published.length = 0;
  const refused = createOpenF1PageReader({ store, lastGoodStore, fetch: lockout });
  const served = await refused.getRaceControl(11392);
  assert.equal(served[0]?.message, 'CHEQUERED FLAG');
  assert.equal(refused.freshness().stale, true);
  assert.equal(published.length, 0, 'a stored copy is never written back as a fresh observation');
});

test('freshness summary reports the oldest stored fetch and prefers the lockout reason', () => {
  assert.deepEqual(summariseOpenF1Freshness([{ source: 'provider', asOf: 9 }]), { stale: false, asOf: null, reason: null });
  assert.deepEqual(summariseOpenF1Freshness([{ source: 'last-good', asOf: 5, reason: 'timeout' }, { source: 'last-good', asOf: 7, reason: 'live-session-lockout' }]), { stale: true, asOf: 5, reason: 'live-session-lockout' });
});

