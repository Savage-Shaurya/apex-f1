import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uniqueBySource, type PhotoCredit } from './photo-credits';

const photo = (subject: string, sourceUrl: string): PhotoCredit => ({ subject, usedOn: 'World champions', author: 'Author', license: 'CC BY-SA 4.0', licenseUrl: null, sourceUrl });

test('a Commons file used for two subjects is credited once, keeping the first subject', () => {
  const list = uniqueBySource([
    photo('Circuit A', 'https://commons.wikimedia.org/wiki/File:A.jpg'),
    photo('Circuit A (alias)', 'https://commons.wikimedia.org/wiki/File:A.jpg'),
    photo('Circuit B', 'https://commons.wikimedia.org/wiki/File:B.jpg'),
  ]);
  assert.deepEqual(list.map((p) => p.subject), ['Circuit A', 'Circuit B']);
});
