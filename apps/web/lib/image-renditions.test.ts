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

test('a motorsport.com URL that is already the s6 rendition still offers phone-sized candidates', () => {
  // Feeds now embed s6 (1200px, ~200 KB); without a srcSet every phone downloaded it for the hero.
  const s6 = 'https://cdn-3.motorsport.com/images/amp/6VyKX7dY/s6/franco-colapinto-alpine.jpg';
  const at = (size: string) => s6.replace('/s6/', `/${size}/`);
  const rendition = bestRendition(s6);
  assert.equal(rendition.src, s6);
  assert.equal(rendition.srcSet, `${at('s3')} 300w, ${at('s2')} 413w, ${at('s1')} 600w, ${s6} 1200w`);
  assert.deepEqual(rendition.fallbacks, []);
});
