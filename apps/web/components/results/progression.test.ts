import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProgression, roundPointsFrom, standingsAt } from './progression';

const races = [
  { round: '1', raceName: 'Australian Grand Prix', Results: [
    { position: '1', positionText: '1', points: '25', Driver: { driverId: 'russell' }, Constructor: { constructorId: 'mercedes' } },
    { position: '2', positionText: '2', points: '18', Driver: { driverId: 'antonelli' }, Constructor: { constructorId: 'mercedes' } },
    { position: '3', positionText: 'R', points: '0', Driver: { driverId: 'leclerc' }, Constructor: { constructorId: 'ferrari' } },
  ] },
  { round: '2', raceName: 'Chinese Grand Prix', Results: [
    { position: '1', positionText: '1', points: '25', Driver: { driverId: 'leclerc' }, Constructor: { constructorId: 'ferrari' } },
    { position: '2', positionText: '2', points: '18', Driver: { driverId: 'antonelli' }, Constructor: { constructorId: 'mercedes' } },
    { position: '3', positionText: '3', points: '15', Driver: { driverId: 'russell' }, Constructor: { constructorId: 'mercedes' } },
  ] },
];
const sprints = [{ round: 2, rows: [{ points: '8', Driver: { driverId: 'leclerc' }, Constructor: { constructorId: 'ferrari' } }] }];

test('running totals add race and sprint points and rank after every round', () => {
  const rounds = roundPointsFrom(races, sprints, 'drivers');
  assert.equal(rounds[1]!.name, 'Chinese Grand Prix');
  assert.equal(rounds[1]!.points.get('leclerc'), 33);
  assert.equal(rounds[0]!.finish?.has('leclerc'), false);
  const state = buildProgression(rounds, [{ id: 'russell', points: 40 }, { id: 'antonelli', points: 36 }, { id: 'leclerc', points: 33 }]);
  assert.equal(state.state, 'available');
  if (state.state !== 'available') return;
  assert.deepEqual(state.progression.totals.get('russell'), [25, 40]);
  assert.deepEqual(state.progression.positions.get('leclerc'), [3, 3]);
  assert.deepEqual(state.progression.positions.get('antonelli'), [2, 2]);
  const after1 = standingsAt(state.progression, 0, ['russell', 'antonelli', 'leclerc']);
  assert.deepEqual(after1.map((r) => [r.id, r.points, r.change]), [['russell', 25, null], ['antonelli', 18, null], ['leclerc', 0, null]]);
  const after2 = standingsAt(state.progression, 1, ['russell', 'antonelli', 'leclerc']);
  assert.equal(after2[2]!.change, 0);
});

test('constructors sum both cars', () => {
  const rounds = roundPointsFrom(races, sprints, 'teams');
  assert.equal(rounds[0]!.points.get('mercedes'), 43);
  assert.equal(rounds[0]!.finish?.get('mercedes'), 1);
});

test('totals that disagree with the published table are withheld, never drawn', () => {
  const rounds = roundPointsFrom(races, [], 'drivers');
  const state = buildProgression(rounds, [{ id: 'russell', points: 40 }, { id: 'antonelli', points: 36 }, { id: 'leclerc', points: 33 }]);
  assert.equal(state.state, 'mismatch');
  assert.equal(buildProgression([], [{ id: 'x', points: 1 }]).state, 'empty');
  assert.equal(buildProgression(rounds, [{ id: 'russell', points: 40 }]).state, 'mismatch');
});

test('chart axis uses a round step with about four intervals', async () => {
  const { niceAxis } = await import('./SeasonChart');
  assert.deepEqual(niceAxis(340), { max: 400, step: 100 });
  assert.deepEqual(niceAxis(578), { max: 600, step: 200 });
  assert.deepEqual(niceAxis(30), { max: 30, step: 10 });
  assert.deepEqual(niceAxis(0), { max: 10, step: 2.5 });
});
