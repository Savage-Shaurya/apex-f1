import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificationFingerprint, pathsFor, runWeekendWatch, watchKey, type ClassificationRow, type FingerprintStore, type WatchRace } from './weekend-watch';
import type { WatchTarget } from './data-freshness';

const race: WatchRace = {
  season: 2026, round: 19, slug: 'americas', routeSlug: 'americas-round-19', raceStartIso: '2026-10-25T20:00:00Z',
  sessions: [{ kind: 'FP1', iso: '2026-10-23T17:30:00Z' }, { kind: 'Q', iso: '2026-10-24T21:00:00Z' }, { kind: 'R', iso: '2026-10-25T20:00:00Z' }],
};
const row = (position: string, driverId: string, time?: string): ClassificationRow => ({ position, positionText: position, points: '0', status: 'Finished', Driver: { driverId }, ...(time ? { Time: { time } } : {}) });
const memoryStore = (): FingerprintStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, async get(key) { return data.get(key) ?? null; }, async set(key, value) { data.set(key, value); } };
};

test('nothing due: no provider read, no revalidation', async () => {
  let reads = 0;
  const report = await runWeekendWatch({ now: Date.parse('2026-10-22T12:00:00Z'), races: [race], store: null, read: async () => { reads++; return []; }, revalidate: () => assert.fail('no revalidation') });
  assert.equal(report.due, 0);
  assert.equal(reads, 0);
});

test('qualifying: pending until published, revalidated once when it lands, then quiet until corrected', async () => {
  const store = memoryStore();
  const revalidated: string[] = [];
  let published: ClassificationRow[] = [];
  const run = (iso: string) => runWeekendWatch({ now: Date.parse(iso), races: [race], store, read: async () => published, revalidate: (t: WatchTarget) => { revalidated.push(`${t.kind}@${iso}`); } });
  assert.deepEqual((await run('2026-10-24T22:05:00Z')).pending, ['2026/19/Q']);
  published = [row('1', 'norris'), row('2', 'verstappen')];
  assert.deepEqual((await run('2026-10-24T22:15:00Z')).changed, ['2026/19/Q']);
  assert.deepEqual((await run('2026-10-24T22:25:00Z')).unchanged, ['2026/19/Q']);
  // A grid penalty reorders the classification: one more revalidation.
  published = [row('1', 'verstappen'), row('2', 'norris')];
  assert.deepEqual((await run('2026-10-24T22:35:00Z')).changed, ['2026/19/Q']);
  assert.deepEqual(revalidated, ['Q@2026-10-24T22:15:00Z', 'Q@2026-10-24T22:35:00Z']);
});

test('race: ingestion runs once per classification and is retried until it lands', async () => {
  const store = memoryStore();
  const results = [row('1', 'norris', '1:33:00.000'), row('2', 'piastri', '+1.2')];
  let attempts = 0;
  let land = false;
  const run = () => runWeekendWatch({
    now: Date.parse('2026-10-25T23:30:00Z'), races: [race], store, read: async (t) => (t.kind === 'R' ? results : []),
    revalidate: () => undefined, ingest: async () => { attempts++; return land; },
  });
  await run();
  assert.equal(store.data.get(watchKey({ season: 2026, round: 19, kind: 'R' }))?.endsWith(':0'), true);
  land = true;
  assert.deepEqual((await run()).ingested, ['2026/19/R']);
  await run();
  assert.equal(attempts, 2, 'no third ingestion for an unchanged, stored classification');
});

test('a failed read is an error (retried), never "not published"; without a store every published read revalidates', async () => {
  let revalidations = 0;
  const failing = await runWeekendWatch({ now: Date.parse('2026-10-24T22:15:00Z'), races: [race], store: null, read: async () => { throw new Error('timeout'); }, revalidate: () => { revalidations++; } });
  assert.equal(failing.errors.length, 1);
  assert.equal(failing.pending.length, 0);
  for (let i = 0; i < 2; i++) await runWeekendWatch({ now: Date.parse('2026-10-24T22:15:00Z'), races: [race], store: null, read: async () => [row('1', 'norris')], revalidate: () => { revalidations++; } });
  assert.equal(revalidations, 2);
});

test('fingerprints follow every displayed field; paths cover the pages that show the result', () => {
  assert.notEqual(classificationFingerprint([row('1', 'norris', '1:33:00.000')]), classificationFingerprint([row('1', 'norris', '1:33:00.100')]));
  assert.deepEqual(pathsFor({ season: 2026, kind: 'Q' }, race), ['/', '/schedule/2026/americas-round-19', '/predict']);
  assert.ok(pathsFor({ season: 2026, kind: 'R' }, race).includes('/results/2026/drivers'));
});
