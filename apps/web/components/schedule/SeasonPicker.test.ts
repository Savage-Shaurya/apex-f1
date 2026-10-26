import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonHref } from './SeasonPicker';

test('a confirmed season choice opens the templated route', () => {
  assert.equal(seasonHref('/schedule/{season}', 1994), '/schedule/1994');
  assert.equal(seasonHref('/results/{season}/teams', '1958'), '/results/1958/teams');
});
