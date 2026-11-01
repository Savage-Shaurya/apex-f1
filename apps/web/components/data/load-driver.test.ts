import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDriverRecord } from './load-driver';

test('DRV-1: a champion\'s record survives a Jolpica outage from the committed championship capture', async () => {
  const down = async () => ({ state: 'unavailable' as const, reason: 'provider' as const });
  // Before: the [slug] layout threw PeopleSourceOutage and an uncached profile was a 500 "Driver page unavailable".
  const clark = await readDriverRecord('clark', down);
  assert.equal(clark.state, 'found');
  assert.ok(clark.state === 'found' && clark.raw.driverId === 'clark' && clark.raw.familyName === 'Clark' && clark.raw.dateOfBirth);
  const schumacher = await readDriverRecord('michael_schumacher', down);
  assert.equal(schumacher.state, 'found');
  // Anyone else is still honestly unavailable; a confirmed miss stays a miss; a live answer wins.
  assert.deepEqual(await readDriverRecord('fixture_nobody', down), { state: 'unavailable', reason: 'provider' });
  assert.deepEqual(await readDriverRecord('clark', async () => ({ state: 'missing' as const })), { state: 'missing' });
  const live = { driverId: 'clark', givenName: 'Jim', familyName: 'Clark', url: '', nationality: 'British' };
  assert.deepEqual(await readDriverRecord('clark', async () => ({ state: 'found' as const, raw: live })), { state: 'found', raw: live });
});

test('DRV-1/DRV-2: the profile reads in parallel and never caches a degraded render for the full window', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../../app/drivers/[slug]/(profile)/page.tsx', import.meta.url), 'utf8');
  // The championship archive starts with the first batch, not after the career and wiki reads.
  assert.match(page, /Promise\.all\(\[[\s\S]{0,900}getDriverResults[\s\S]{0,900}loadDriverChampionshipArchive/);
  // Facts and the Commons photo are chained on the Wikipedia read, not awaited one by one after everything else.
  assert.match(page, /wikiRead\.then\(/);
  // A failed team window (no team-mate duel, no photos) is a degraded render too.
  assert.match(page, /windowRead\.state === 'unavailable'\) await outageConnection\(\)/);
});
