import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitSize, hyphenParts } from './fit';

test('fitSize caps the size by the longest word, breaking after hyphens', () => {
  const one = fitSize('Montgomerie-Charrington', '10rem');
  const parts = fitSize('Montgomerie-', '10rem');
  assert.equal(one, parts, 'a hyphenated name is fitted by its longest part');
  assert.match(fitSize('Norris', '10rem', { oneLine: true }), /^min\(10rem, calc\(100cqi \/ [\d.]+\)\)$/);
  assert.deepEqual(hyphenParts('Montgomerie-Charrington'), ['Montgomerie-', 'Charrington']);
  assert.deepEqual(hyphenParts('Norris'), ['Norris']);
});
