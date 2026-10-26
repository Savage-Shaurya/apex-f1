import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestRendition } from './image-renditions';

const PEREZ = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sergio_P%C3%A9rez_2019.jpg/330px-Sergio_P%C3%A9rez_2019.jpg';
// Commons renditions are delivered from Apex's own origin (F-11, lib/commons-proxy.ts).
const PEREZ_FP = '/media/commons/thumb/a/ab/Sergio_P%C3%A9rez_2019.jpg/330px-Sergio_P%C3%A9rez_2019.jpg';

test('D2-MEDIA-CREDITS-4: Commons candidates never exceed the original width', () => {
  const small = bestRendition(PEREZ, { intrinsicWidth: 433 });
  assert.equal(small.maxWidth, 433);
  assert.equal(small.srcSet, `${PEREZ_FP} 330w, /media/commons/a/ab/Sergio_P%C3%A9rez_2019.jpg 433w`);
  assert.equal(small.src, PEREZ_FP);
  assert.ok(!small.srcSet!.includes('960w') && !small.srcSet!.includes('1920w'));
  const tiny = bestRendition(PEREZ, { intrinsicWidth: 300 });
  assert.equal(tiny.src, '/media/commons/a/ab/Sergio_P%C3%A9rez_2019.jpg');
  // Without metadata the previous bucket set is kept.
  assert.equal(bestRendition(PEREZ).maxWidth, 1920);
  const large = bestRendition(PEREZ, { intrinsicWidth: 4000 });
  assert.ok(large.srcSet!.includes('1920w') && large.srcSet!.endsWith('4000w'));
});
