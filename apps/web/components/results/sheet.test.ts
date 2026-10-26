import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtPoints, maxRoundPoints, seriesValue, titleCounts, titleMaths } from './sheet';

test('most points on offer per round follow the current rules', () => {
  assert.equal(maxRoundPoints('drivers', { round: 1, sprint: false }), 25);
  assert.equal(maxRoundPoints('drivers', { round: 1, sprint: true }), 33);
  assert.equal(maxRoundPoints('teams', { round: 1, sprint: false }), 43);
  assert.equal(maxRoundPoints('teams', { round: 1, sprint: true }), 58);
});

test('title maths counts only the rounds after the table and who can still draw level', () => {
  const cal = [1, 2, 3, 4, 5].map((round) => ({ round, sprint: round === 5 }));
  const table = [{ id: 'a', points: 100 }, { id: 'b', points: 60 }, { id: 'c', points: 41 }, { id: 'd', points: 40 }];
  const m = titleMaths('drivers', table, cal, 3)!;
  assert.equal(m.roundsLeft, 2);
  assert.equal(m.pointsLeft, 58);
  assert.equal(m.gap, 40);
  assert.equal(m.clinched, false);
  // 41 + 58 = 99 < 100: out. 60 + 58 = 118: alive.
  assert.deepEqual(m.alive, ['b']);
  assert.equal(titleMaths('drivers', table, cal, 5)!.clinched, true);
  assert.equal(titleMaths('drivers', table.slice(0, 1), cal, 3), null);
  assert.equal(titleMaths('drivers', table, [], 3), null);
});

test('a tie on points still counts as alive (countback decides)', () => {
  const m = titleMaths('drivers', [{ id: 'a', points: 50 }, { id: 'b', points: 25 }], [{ round: 2, sprint: false }], 1)!;
  assert.deepEqual(m.alive, ['b']);
  assert.equal(m.clinched, false);
});

test('series values: points, gap to the leader of that round, position', () => {
  const totals = { a: [25, 25, 50], b: [18, 43, 61] };
  const positions = { a: [1, 2, 2], b: [2, 1, 1] };
  assert.equal(seriesValue('points', totals, positions, 'a', 2), 50);
  assert.equal(seriesValue('gap', totals, positions, 'a', 0), 0);
  assert.equal(seriesValue('gap', totals, positions, 'a', 1), 18);
  assert.equal(seriesValue('gap', totals, positions, 'b', 1), 0);
  assert.equal(seriesValue('position', totals, positions, 'b', 0), 2);
  assert.equal(seriesValue('points', totals, positions, 'zz', 0), null);
});

test('points formatting and title counts', () => {
  assert.equal(fmtPoints(12), '12');
  assert.equal(fmtPoints(12.5), '12.5');
  assert.equal(fmtPoints(0.14 + 0.01), '0.15');
  assert.deepEqual(titleCounts([
    { year: 1981, champion: 'Nelson Piquet' }, { year: 1985, champion: 'Alain Prost' }, { year: 1983, champion: 'Nelson Piquet' },
    { year: 1986, champion: 'Alain Prost' }, { year: 1982, champion: 'Keke Rosberg' }, { year: 1989, champion: null },
  ]), [{ name: 'Nelson Piquet', titles: 2 }, { name: 'Alain Prost', titles: 2 }, { name: 'Keke Rosberg', titles: 1 }]);
});

test('R3-DATA-4: the 2018 constructors table carries the official order, other tables none', async () => {
  const { tableNote } = await import('./sheet');
  const note = tableNote('teams', 2018);
  assert.ok(note && note.includes('Haas F1 Team finished 5th') && note.includes('Racing Point Force India 7th (52)'));
  assert.equal(tableNote('drivers', 2018), null);
  assert.equal(tableNote('teams', 2019), null);
});
