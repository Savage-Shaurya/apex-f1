import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { constructorTableNote, officialBetter, teamRecordNotes } from './provider-notes';

// Real provider table: Jolpica /2018/constructorstandings.json (captured 2026-10-26), [position, constructorId, points].
const provider2018 = JSON.parse(readFileSync(new URL('./fixtures/jolpica-2018-constructorstandings.json', import.meta.url), 'utf8')) as Array<[string, string, string]>;

test('R3-DATA-4: the 2018 note matches the provider table it explains, without rewriting it', () => {
  const note = constructorTableNote(2018)!;
  assert.ok(note.table.includes('Haas finished 5th (93 points)'));
  assert.ok(!/jolpica|provider/i.test(note.table + Object.values(note.teams).map((t) => t.line).join(' ')), 'copy never names the data provider');
  for (const [slug, team] of Object.entries(note.teams)) {
    const row = provider2018.find(([, id]) => id === slug)!;
    assert.equal(Number(row[0]), team.provider, slug);
  }
  assert.equal(constructorTableNote(2019), null);
});

test('R3-DATA-4: team pages get the note only for seasons they have, and Haas learns its official best', () => {
  assert.deepEqual(teamRecordNotes('haas', [2016, 2017, 2018]).map((n) => [n.season, n.official]), [[2018, 5]]);
  assert.deepEqual(teamRecordNotes('haas', [2019]), []);
  assert.deepEqual(teamRecordNotes('mercedes', [2018]), []);
  assert.equal(officialBetter(teamRecordNotes('haas', [2018]), 6), 'Officially P5 in 2018 (see note below)');
  assert.equal(officialBetter(teamRecordNotes('mclaren', [2018]), 1), null);
});
