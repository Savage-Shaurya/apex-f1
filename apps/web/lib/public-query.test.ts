import assert from 'node:assert/strict';
import test from 'node:test';
import { scalarPublicQuery } from './public-query';

test('public query preserves ordinary search text and scalar filter values', () => {
  for (const value of ['Senna', 'Max Verstappen', '1988', 'FORMULA-1', 'most-viewed', 'en', '', 'a'.repeat(256)]) {
    assert.equal(scalarPublicQuery(value), value);
  }
});

test('repeated parameters clear consistently without selecting an arbitrary value', () => {
  for (const value of [['Senna', 'Hamilton'], ['FORMULA-1'], ['autosport', 'racefans'], [], ['a'.repeat(256), 'b']]) {
    assert.equal(scalarPublicQuery(value), undefined);
  }
});

test('oversized and nonscalar input cannot reach public string operations', () => {
  for (const value of ['a'.repeat(257), null, undefined, 1950, {}, { toLowerCase: 'no' }]) {
    assert.equal(scalarPublicQuery(value), undefined);
    assert.doesNotThrow(() => (scalarPublicQuery(value) ?? '').trim().toLowerCase());
  }
});
