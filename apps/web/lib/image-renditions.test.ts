import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestRendition, optimizedRendition } from './image-renditions';

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
  // A 4000 px original is never a candidate (SRL-1, audit 2026-11-01): the 1920 bucket is the top.
  assert.ok(large.srcSet!.endsWith('1920w') && !large.srcSet!.includes('4000w'));
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

test('the hero photo can go through the Next image optimizer, with the original as fallback', () => {
  // The first news photo was a 330 KB JPEG straight from the publisher (Lighthouse LCP 5.9 s in CI).
  const s6 = 'https://cdn-3.motorsport.com/images/amp/6VyKX7dY/s6/franco-colapinto-alpine.jpg';
  const optimized = optimizedRendition(bestRendition(s6));
  const at = (w: number) => `/_next/image?url=${encodeURIComponent(s6)}&w=${w}&q=75`;
  assert.equal(optimized.src, at(1440));
  // Only configured widths, never wider than the first size that covers the 1200 px original,
  // which is labelled with the real 1200 px (the optimizer never enlarges).
  assert.equal(optimized.srcSet, `${at(384)} 384w, ${at(640)} 640w, ${at(1080)} 1080w, ${at(1440)} 1200w`);
  assert.deepEqual(optimized.fallbacks, [s6]);
  // Same-origin and unknown hosts are left alone (the optimizer only fetches configured hosts).
  assert.equal(optimizedRendition(bestRendition('https://example.com/a.jpg')).src, 'https://example.com/a.jpg');
});

test('ESPN combiner photos get its own w= renditions (no optimizer pass), capped at the real width', () => {
  const src = 'https://a2.espncdn.com/combiner/i?img=%2Fphoto%2F2026%2F0819%2Fr1703751_1296x729_16%2D9.jpg';
  const r = bestRendition(src);
  assert.equal(r.maxWidth, 1296);
  const list = (r.srcSet ?? '').split(', ').map((c) => c.split(' '));
  assert.deepEqual(list.map(([, w]) => w), ['480w', '640w', '960w', '1296w']);
  assert.match(list[0]![0]!, /^https:\/\/a2\.espncdn\.com\/combiner\/i\?img=%2Fphoto%2F2026%2F0819%2Fr1703751_1296x729_16%2D9\.jpg&w=480$/);
  assert.equal(r.src, `${src}&w=1296`);
  assert.deepEqual(r.fallbacks, [src]);
  // An existing w= is replaced, not doubled.
  assert.equal(bestRendition(`${src}&w=300`).src, `${src}&w=1296`);
  // The optimizer is not spent on it.
  assert.doesNotMatch(optimizedRendition(r).src, /_next\/image/);
});
