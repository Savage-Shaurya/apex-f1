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

test('the profile and career routes prebuild the current grid (not an empty list); the profile adds every champion (DRV-1)', async () => {
  const { readFileSync } = await import('node:fs');
  const career = readFileSync(new URL('../../app/drivers/[slug]/career/page.tsx', import.meta.url), 'utf8');
  assert.match(career, /export async function generateStaticParams\(\)\s*\{\s*return currentSeasonDriverParams\(\);/);
  const profile = readFileSync(new URL('../../app/drivers/[slug]/(profile)/page.tsx', import.meta.url), 'utf8');
  assert.match(profile, /export async function generateStaticParams\(\)\s*\{\s*return driverProfileParams\(\);/);
});

test('DRV-1 + review finding 3: the most visited champion profiles are prebuilt (multiple and this century\'s champions), not all 35', async () => {
  const { driverProfileParams } = await import('./static-params');
  const probed: string[] = [];
  const slugs = (await driverProfileParams(standings(['antonelli', 'hamilton']), {}, async ({ slug }) => { probed.push(slug); return true; })).map((p) => p.slug);
  for (const champion of ['michael_schumacher', 'senna', 'prost', 'fangio', 'lauda', 'vettel', 'raikkonen', 'button', 'rosberg', 'max_verstappen']) assert.ok(slugs.includes(champion), champion);
  // One-title champions of the last century render on first visit (then ISR), instead of costing Jolpica reads at every build.
  for (const champion of ['farina', 'hawthorn', 'hunt', 'hulme', 'clark', 'hakkinen']) assert.ok(!slugs.includes(champion), champion);
  assert.ok(probed.length <= 18, `at most 18 driver records read at build, got ${probed.length}`);
  assert.equal(slugs.filter((s) => s === 'hamilton').length, 1, 'a current champion once');
  assert.deepEqual(slugs.slice(0, 2), ['antonelli', 'hamilton'], 'the current grid first');
  // A champion whose record cannot be read at build time is left out (renders on first visit), never fails the build.
  const some = await driverProfileParams(standings([]), {}, async ({ slug }) => slug !== 'senna');
  assert.ok(!some.some((p) => p.slug === 'senna'));
});


test('F-01: a driver whose record cannot be read during the build is left out of the prebuild (renders on first visit), the rest still prebuild', async () => {
  const probe = async ({ slug }: { slug: string }) => { if (slug === 'russell') throw new Error('jolpica: timeout'); return slug !== 'hulkenberg'; };
  assert.deepEqual(await currentSeasonDriverParams(standings(['antonelli', 'russell', 'hulkenberg', 'lawson']), noWait, probe), [{ slug: 'antonelli' }, { slug: 'lawson' }]);
});
