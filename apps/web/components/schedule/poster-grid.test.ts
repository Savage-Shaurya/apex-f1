import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gridOrder, heroStrip, monthMarkers, stripHasOutlines } from './poster-grid';

const months = [
  { month: 'March', rounds: [1, 2, 3] },
  { month: 'April', rounds: [4, 5, 6, 7] },
  { month: 'May', rounds: [8, 9] },
];

test('SRL-4: every round is in one continuous grid, in calendar order, each once', () => {
  assert.deepEqual(gridOrder(months), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(gridOrder([{ rounds: [1, 2] }, { rounds: [2, 3] }]), [1, 2, 3]);
});

test('SRL-4: the month name marks only the first round of each month', () => {
  const m = monthMarkers(months);
  assert.deepEqual([...m.entries()], [[1, 'March'], [4, 'April'], [8, 'May']]);
  assert.equal(m.has(2), false);
});

test('SRL-4: SeasonPosters renders one grid list, not one per month', () => {
  const src = readFileSync(new URL('./SeasonPosters.tsx', import.meta.url), 'utf8');
  assert.equal((src.match(/<ol\b/g) ?? []).length, 1);
  assert.doesNotMatch(src, /months\.map\(/);
});

test('SRL-2: the hero strip lights run rounds, puts the comet on the focus round and keeps rounds ahead dim', () => {
  const o = { d: 'M0 0Z', width: 1, height: 1 };
  const rounds = [
    { round: 1, name: 'A', raceIso: '2026-03-08T04:00:00Z', outline: o },
    { round: 2, name: 'B', raceIso: '2026-03-22T04:00:00Z', outline: null },
    { round: 3, name: 'C', raceIso: '2026-04-05T04:00:00Z', outline: o },
    { round: 4, name: 'D', raceIso: '2026-04-19', outline: o },
  ];
  const now = Date.parse('2026-03-30T00:00:00Z');
  assert.deepEqual(heroStrip(rounds, 3, now).map((s) => s.state), ['run', 'run', 'focus', 'ahead']);
  assert.equal(heroStrip(rounds, null, Date.parse('2027-01-01')).every((s) => s.state === 'run'), true);
  assert.equal(stripHasOutlines(heroStrip(rounds, 3, now)), true);
  assert.equal(stripHasOutlines([{ outline: null }]), false);
});

test('SRL-2: the calendar hero draws the season strip, so its right side is never empty', () => {
  const src = readFileSync(new URL('./SeasonCalendar.tsx', import.meta.url), 'utf8');
  assert.match(src, /<SeasonStrip\b/);
});
