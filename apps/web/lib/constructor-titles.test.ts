import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotConstructorChampions, CHAMPIONSHIP_SNAPSHOT_THROUGH } from './championship-snapshot';
import { constructorTitlesFromArchive } from './constructor-titles';

const archive = { state: 'complete' as const, records: snapshotConstructorChampions(2025), missing: [], unavailable: [], through: 2025 };
const titles = (id: string) => {
  const read = constructorTitlesFromArchive(id, archive);
  assert.equal(read.state, 'confirmed');
  return read.state === 'confirmed' ? read.record : null!;
};

test('title counts come from the archive by Jolpica id (verified against Jolpica, through 2025)', () => {
  assert.ok(CHAMPIONSHIP_SNAPSHOT_THROUGH >= 2025);
  const expected: Record<string, number> = { ferrari: 16, mclaren: 10, williams: 9, mercedes: 8, red_bull: 6, renault: 2, benetton: 1, tyrrell: 1, brawn: 1, vanwall: 1, brm: 1, 'cooper-climax': 2, 'lotus-climax': 2, 'brabham-repco': 2, 'lotus-ford': 1, 'matra-ford': 1, haas: 0, cadillac: 0, lotus_f1: 0 };
  for (const [id, count] of Object.entries(expected)) assert.equal(titles(id).titles, count, id);
  assert.equal(titles('mclaren').years[0], 2025);
  assert.equal(titles('mclaren').through, 2025);
});

test('marque pages fold in engine-suffixed entrant ids and say which', () => {
  const lotus = titles('team_lotus');
  assert.equal(lotus.titles, 7);
  assert.deepEqual(lotus.years, [1978, 1973, 1972, 1970, 1968, 1965, 1963]);
  assert.deepEqual(lotus.viaAliases.map(alias => [alias.id, alias.years.length]), [['lotus-climax', 2], ['lotus-ford', 1]]);
  assert.equal(titles('cooper').titles, 2);
  assert.equal(titles('brabham').titles, 2);
  assert.equal(titles('matra').titles, 1);
  assert.equal(titles('ferrari').viaAliases.length, 0);
});

test('an incomplete archive yields unknown, never a count or a zero', () => {
  const partial = { ...archive, state: 'partial' as const, missing: [2026], through: 2026 };
  assert.deepEqual(constructorTitlesFromArchive('haas', partial), { state: 'unknown', through: 2026 });
});
