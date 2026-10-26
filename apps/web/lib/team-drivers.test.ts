import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { teamStints } from '@apex/api-client/jolpica';
import { driversForTeam } from './team-drivers';
import type { GridDriver } from './grid';

// Real Jolpica 2026 rows for Lawson (rounds 1-11 rb, 12-14 red_bull, 15-18 rb).
const fixture = JSON.parse(readFileSync(new URL('../../../packages/api-client/src/jolpica/fixtures/lawson-2026.json', import.meta.url), 'utf8')) as { races: Array<{ round: string }> };

const driver = (slug: string, teamSlug: string, teams: string[], points: number): GridDriver => ({
  slug, code: slug.slice(0, 3).toUpperCase(), number: null, firstName: slug, lastName: slug, team: teamSlug, teamSlug,
  teams: teams.map((t) => ({ slug: t, name: t })), color: '#000000', headshot: null, cutout: null, portrait: null, position: 1, points, wins: 0,
});
// Points as in the 2026 standings (Jolpica /2026/driverstandings.json).
const grid = [
  driver('max_verstappen', 'red_bull', ['red_bull'], 236),
  driver('hadjar', 'red_bull', ['red_bull'], 105),
  driver('lawson', 'rb', ['red_bull', 'rb'], 77),
  driver('arvid_lindblad', 'rb', ['rb'], 38),
  driver('tsunoda', 'rb', ['rb'], 1),
];

test('R3-DATA-1: RB lists Lawson (current) with his RB points; Red Bull lists him with the points he scored there', () => {
  const splits = new Map([['lawson', teamStints('lawson', fixture.races as never)]]);
  const rb = driversForTeam('rb', grid, splits);
  assert.deepEqual(rb.map((e) => [e.driver.slug, e.points, e.current]), [['lawson', 56, true], ['arvid_lindblad', 38, true], ['tsunoda', 1, true]]);
  const redBull = driversForTeam('red_bull', grid, splits);
  assert.deepEqual(redBull.map((e) => [e.driver.slug, e.points, e.current]), [['max_verstappen', 236, true], ['hadjar', 105, true], ['lawson', 14, false]]);
});

test('R3-DATA-1: without the per-team split a shared driver shows unknown points, never his championship total', () => {
  const rb = driversForTeam('rb', grid, new Map([['lawson', null]]));
  assert.equal(rb.find((e) => e.driver.slug === 'lawson')!.points, null);
});
