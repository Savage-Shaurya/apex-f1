import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutEras } from './circuit-history';

test('lap length by year keeps Grand Prix layouts only, newest first', () => {
  const eras = layoutEras([
    { index: 1, name: 'Grand Prix Circuit (2015–present)', lengthKm: 4.304, segments: [{ name: 'Grand Prix Circuit', ranges: [{ from: 2015, to: null }], excluded: false }] },
    { index: 2, name: 'Formula E Circuit (2020–2022)', lengthKm: 2.606, segments: [{ name: 'Formula E Circuit', ranges: [{ from: 2020, to: 2022 }], excluded: true }] },
    { index: 3, name: 'National Circuit (2015–present)', lengthKm: 3.909, segments: [{ name: 'National Circuit', ranges: [{ from: 2015, to: null }], excluded: false }] },
    { index: 4, name: 'Grand Prix Circuit (1986–1992)', lengthKm: 4.421, segments: [{ name: 'Grand Prix Circuit', ranges: [{ from: 1986, to: 1992 }], excluded: false }] },
  ]);
  assert.deepEqual(eras.map((e) => [e.from, e.to, e.lengthKm]), [[2015, null, 4.304], [1986, 1992, 4.421]]);
});

test('without Grand Prix names every non-excluded layout with a length counts', () => {
  const eras = layoutEras([
    { index: 1, name: 'Circuit de Monaco (2015–present)', lengthKm: 3.337, segments: [{ name: 'Circuit de Monaco', ranges: [{ from: 2015, to: null }], excluded: false }] },
    { index: 2, name: 'Circuit (2003–2014)', lengthKm: 3.34, segments: [{ name: 'Circuit', ranges: [{ from: 2003, to: 2014 }], excluded: false }] },
    { index: 3, name: 'No length (1950)', lengthKm: null, segments: [{ name: 'x', ranges: [{ from: 1950, to: 1950 }], excluded: false }] },
  ]);
  assert.equal(eras.length, 2);
  assert.equal(eras[0]!.lengthKm, 3.337);
});
