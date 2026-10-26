import assert from 'node:assert/strict';
import { test } from 'node:test';
import raw from './data/championship-snapshot.json';
import { validateChampionshipSnapshot } from './championship-snapshot';

test('the committed snapshot is contiguous, one verbatim P1 row per season', () => {
  const snapshot = validateChampionshipSnapshot(raw);
  assert.equal(snapshot.drivers.length, snapshot.through - 1950 + 1);
  assert.equal(snapshot.constructors.length, snapshot.through - 1958 + 1);
});

test('truncated, reordered or edited snapshots are rejected', () => {
  const clone = () => structuredClone(raw) as typeof raw;
  const truncated = clone(); truncated.drivers.pop();
  const reordered = clone(); [reordered.constructors[0], reordered.constructors[1]] = [reordered.constructors[1]!, reordered.constructors[0]!];
  const edited = clone(); edited.drivers[0]!.entry.position = '2';
  const source = clone(); source.drivers[1]!.source = 'https://example.org';
  for (const bad of [truncated, reordered, edited, source]) assert.throws(() => validateChampionshipSnapshot(bad), /Invalid championship snapshot/);
});
