import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teamSeasons } from './team-stats';
import type { RaceRow, RaceRows } from '@/components/drivers/people';

const row = (driver: string, position: number | null, points = 0): RaceRow => ({
  position,
  positionText: position === null ? 'R' : String(position),
  points,
  grid: null,
  status: 'Finished',
  driver: { slug: driver, fullName: driver },
  constructor: { slug: 'mercedes', name: 'Mercedes' },
});
const race = (round: number, rows: RaceRow[]): RaceRows => ({ season: 2026, round, raceName: `R${round}`, country: 'X', rows });

test('teamSeasons totals both cars, counts one-twos and orders newest first', () => {
  const seasons = teamSeasons([
    { year: 2025, races: [race(1, [row('a', 3, 15), row('b', null)])] },
    { year: 2026, races: [race(1, [row('a', 1, 25), row('b', 2, 18)]), race(2, [row('a', 5, 10), row('b', 1, 25)])] },
    { year: 2024, races: [] },
  ]);
  assert.deepEqual(seasons.map((s) => s.year), [2026, 2025]);
  const s = seasons[0]!;
  assert.equal(s.races, 2);
  assert.equal(s.wins, 2);
  assert.equal(s.podiums, 3);
  assert.equal(s.oneTwos, 1);
  assert.equal(s.points, 78);
  assert.equal(s.best, 1);
  assert.deepEqual(s.drivers.map((d) => d.starts), [2, 2]);
  assert.equal(seasons[1]!.best, 3);
  assert.equal(seasons[1]!.podiums, 1);
});
