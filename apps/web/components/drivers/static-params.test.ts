import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentSeasonDriverParams } from './static-params';

/**
 * The current grid's profile and career pages are prebuilt, so each always has
 * a good cached copy: under ISR a later provider outage throws, and Next keeps
 * serving that copy (stale-on-error) instead of a first-visit error screen.
 */
const standings = (ids: string[]) => async () => ({ state: 'available' as const, snapshot: { standings: ids.map((driverId) => ({ Driver: { driverId } })) } });

test('every driver in the current standings is a prebuilt path', async () => {
  assert.deepEqual(await currentSeasonDriverParams(standings(['antonelli', 'russell', 'hulkenberg'])), [{ slug: 'antonelli' }, { slug: 'russell' }, { slug: 'hulkenberg' }]);
});

const noWait = { sleep: async () => {} };

test('an outage at build time (after the bounded retry) prebuilds nothing (pages render on first visit) and never fails the build', async () => {
  assert.deepEqual(await currentSeasonDriverParams(async () => ({ state: 'unavailable' as const, snapshot: null }), noWait), []);
  assert.deepEqual(await currentSeasonDriverParams(async () => { throw new Error('socket hang up'); }, noWait), []);
});

test('a transient standings failure is retried, so the current grid is still prebuilt', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 2 ? { state: 'unavailable' as const, snapshot: null } : { state: 'available' as const, snapshot: { standings: [{ Driver: { driverId: 'lawson' } }] } });
  assert.deepEqual(await currentSeasonDriverParams(flaky, noWait), [{ slug: 'lawson' }]);
  assert.equal(calls, 2);
});

test('ids that are not valid route slugs are dropped, duplicates once', async () => {
  assert.deepEqual(await currentSeasonDriverParams(standings(['max_verstappen', '../x', 'max_verstappen', ''])), [{ slug: 'max_verstappen' }]);
});

test('the profile and career routes prebuild the current grid (not an empty list)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['../../app/drivers/[slug]/(profile)/page.tsx', '../../app/drivers/[slug]/career/page.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /export async function generateStaticParams\(\)\s*\{\s*return currentSeasonDriverParams\(\);/, file);
  }
});

test('F-01: a driver whose record cannot be read during the build is left out of the prebuild (renders on first visit), the rest still prebuild', async () => {
  const probe = async ({ slug }: { slug: string }) => { if (slug === 'russell') throw new Error('jolpica: timeout'); return slug !== 'hulkenberg'; };
  assert.deepEqual(await currentSeasonDriverParams(standings(['antonelli', 'russell', 'hulkenberg', 'lawson']), noWait, probe), [{ slug: 'antonelli' }, { slug: 'lawson' }]);
});
