import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotColours, TEAM_COLOUR_SNAPSHOT } from './colour-snapshot';

test('the committed OpenF1 colour snapshot is a real, complete last-good response', () => {
  const s = TEAM_COLOUR_SNAPSHOT;
  assert.ok(Number.isInteger(s.session_key) && s.session_key > 0);
  assert.ok(Number.isFinite(Date.parse(s.session_end)), 'session_end is a timestamp');
  assert.ok(s.drivers.length >= 20, 'a full grid');
  for (const d of s.drivers) {
    assert.match(d.name_acronym, /^[A-Z]{3}$/);
    assert.match(d.team_colour, /^[0-9A-F]{6}$/i);
  }
});

test('snapshot colours apply only to the season they were captured in', () => {
  const rows = [{ constructorSlug: 'mclaren', code: 'NOR' }, { constructorSlug: 'ferrari', code: 'LEC' }];
  const same = snapshotColours(TEAM_COLOUR_SNAPSHOT, TEAM_COLOUR_SNAPSHOT.season, rows);
  assert.match(same.mclaren ?? '', /^#[0-9A-F]{6}$/);
  assert.match(same.ferrari ?? '', /^#[0-9A-F]{6}$/);
  assert.deepEqual({ ...snapshotColours(TEAM_COLOUR_SNAPSHOT, TEAM_COLOUR_SNAPSHOT.season + 1, rows) }, {});
  assert.deepEqual({ ...snapshotColours(TEAM_COLOUR_SNAPSHOT, null, rows) }, {});
});
