import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { orderConstructorsByLatestRace, teamStints } from './team-stints';

// Real provider rows (Lawson only), captured from Jolpica 2026-10-26.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/lawson-2026.json', import.meta.url), 'utf8')) as {
  standing: { Driver: { driverId: string }; Constructors: Array<{ constructorId: string; name: string }> } & Record<string, unknown>;
  races: Array<{ round: string; Results: Array<Record<string, unknown>> } & Record<string, unknown>>;
};

test('R3-DATA-1: the provider lists Lawson 2026 as [rb, red_bull] in first-appearance order', () => {
  assert.deepEqual(fixture.standing.Constructors.map((team) => team.constructorId), ['rb', 'red_bull']);
  assert.equal(fixture.races.at(-1)!.Results[0]!.Constructor && (fixture.races.at(-1)!.Results[0]!.Constructor as { constructorId: string }).constructorId, 'rb');
});

test('R3-DATA-1: stints come from race entries, current team last, with points per team', () => {
  const stints = teamStints('lawson', fixture.races);
  assert.deepEqual(stints.map((s) => [s.constructorId, s.firstRound, s.lastRound, s.races, s.points]), [
    ['red_bull', 12, 14, 3, 14],
    ['rb', 1, 18, 15, 56],
  ]);
  // A table filed at round 14 has Red Bull as the latest team.
  assert.equal(teamStints('lawson', fixture.races, [], 14).at(-1)!.constructorId, 'red_bull');
});

test('R3-DATA-1: sprint points are credited to the team the driver drove for that weekend', () => {
  const sprint = { round: '13', SprintResults: [{ points: '3', Driver: { driverId: 'lawson' }, Constructor: { constructorId: 'red_bull', name: 'Red Bull' } }] };
  const stints = teamStints('lawson', fixture.races, [sprint]);
  assert.equal(stints.find((s) => s.constructorId === 'red_bull')!.points, 17);
  assert.equal(stints.find((s) => s.constructorId === 'rb')!.points, 56);
});

test('R3-DATA-1: reordering puts the latest team last; no race evidence keeps the provider order', () => {
  assert.deepEqual(orderConstructorsByLatestRace(fixture.standing.Constructors, 'lawson', fixture.races).map((t) => t.constructorId), ['red_bull', 'rb']);
  assert.deepEqual(orderConstructorsByLatestRace(fixture.standing.Constructors, 'lawson', []).map((t) => t.constructorId), ['rb', 'red_bull']);
  assert.deepEqual(orderConstructorsByLatestRace(fixture.standing.Constructors, 'lawson', fixture.races, 14).map((t) => t.constructorId), ['rb', 'red_bull']);
});
