import assert from 'node:assert/strict';
import { test } from 'node:test';
import { championshipHistory, historySummary, marqueMatcher, type SeasonTable } from './championship-history';

const e = (id: string, name: string, position: number | null, points: number, wins = 0) => ({
  position: position === null ? undefined : String(position),
  positionText: position === null ? '-' : String(position),
  points: String(points),
  wins: String(wins),
  Constructor: { constructorId: id, name },
});

test('marqueMatcher folds engine-suffixed entrants into the marque only', () => {
  const lotus = marqueMatcher('team_lotus');
  assert.equal(lotus('team_lotus'), true);
  assert.equal(lotus('lotus-climax'), true);
  assert.equal(lotus('lotus-ford'), true);
  assert.equal(lotus('lotus_f1'), false);
  assert.equal(marqueMatcher('mclaren')('mclaren-ford'), true);
  assert.equal(marqueMatcher('mclaren')('mclarenx'), false);
});

test('championshipHistory keeps the best entry, sums wins and names other entrants', () => {
  const tables: SeasonTable[] = [
    { year: 1963, round: 10, entries: [e('lotus-climax', 'Lotus-Climax', 1, 54, 7), e('lotus-brm', 'Lotus-BRM', 6, 3)] },
    { year: 1964, round: 10, entries: [e('ferrari', 'Ferrari', 1, 45, 3)] },
    { year: 1978, round: 16, entries: [e('team_lotus', 'Team Lotus', 1, 86, 8)] },
  ];
  const rows = championshipHistory('team_lotus', tables);
  assert.deepEqual(rows.map((r) => [r.year, r.position, r.points, r.wins]), [[1978, 1, 86, 8], [1963, 1, 54, 7]]);
  assert.deepEqual(rows[1]!.entrants, ['Lotus-Climax', 'Lotus-BRM']);
  assert.deepEqual(rows[0]!.entrants, []);
});

test('championshipHistory reports an unranked season honestly', () => {
  const rows = championshipHistory('x', [{ year: 2001, round: 17, entries: [e('x', 'X', null, 0)] }]);
  assert.equal(rows[0]!.position, null);
  assert.equal(rows[0]!.positionText, 'Unranked');
  const excluded = championshipHistory('mclaren', [{ year: 2007, round: 17, entries: [{ positionText: 'E', points: '0', wins: '8', Constructor: { constructorId: 'mclaren', name: 'McLaren' } }] }]);
  assert.equal(excluded[0]!.positionText, 'Excluded');
});

test('historySummary counts seasons, best finish and wins', () => {
  const tables: SeasonTable[] = [2019, 2020, 2021].map((year, i) => ({ year, round: 20, entries: [e('m', 'M', [1, 3, 1][i]!, 100, [10, 2, 8][i]!)] }));
  const s = historySummary(championshipHistory('m', tables));
  assert.deepEqual(s, { seasons: 3, first: 2019, last: 2021, best: 1, bestCount: 2, wins: 20, podiumSeasons: 3 });
});
