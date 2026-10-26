import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotTable, STANDINGS_SNAPSHOT } from './standings-snapshot';
import { championshipHistory } from '../championship-history';

test('the committed constructor standings capture holds every completed season from 1958', () => {
  const s = STANDINGS_SNAPSHOT;
  assert.equal(s.from, 1958);
  assert.equal(s.seasons.length, s.through - s.from + 1);
  s.seasons.forEach((season, i) => {
    assert.equal(season.year, s.from + i, 'contiguous seasons');
    assert.ok(season.round !== null && season.round > 0, `${season.year} is a final table`);
    assert.equal(season.entries[0]?.position, '1', `${season.year} has a champion row`);
  });
  // Known anchors of the record.
  assert.equal(snapshotTable(s, 1958)?.entries[0]?.Constructor.constructorId, 'vanwall');
  assert.equal(snapshotTable(s, 2025)?.entries[0]?.Constructor.constructorId, 'mclaren');
});

test('snapshotTable answers only for captured seasons', () => {
  assert.equal(snapshotTable(STANDINGS_SNAPSHOT, 1957), null);
  assert.equal(snapshotTable(STANDINGS_SNAPSHOT, STANDINGS_SNAPSHOT.through + 1), null);
});

test('a marque history reads straight from the capture (Lotus engine entrants folded)', () => {
  const tables = STANDINGS_SNAPSHOT.seasons.map((x) => snapshotTable(STANDINGS_SNAPSHOT, x.year)!);
  const lotus = championshipHistory('team_lotus', tables);
  assert.ok(lotus.some((r) => r.year === 1963 && r.position === 1), 'Lotus-Climax 1963 title counted for Team Lotus');
});
