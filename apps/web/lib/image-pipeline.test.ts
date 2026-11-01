import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bestRendition, commonsBucketRendition, optimizedRendition, OPTIMIZER_WIDTHS } from './image-renditions';
import * as commons from './commons-image';
import { pixelWidth, sharpnessRatio, srcSetCandidates } from './image-measure';
import { evaluateSizes } from './sizes-eval';

/**
 * Visual-quality audit 2026-11-01, root cause B (image pipeline): each test
 * names its finding and fails on the pre-fix code.
 */

const web = new URL('../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, web), 'utf8');
const candidates = (srcSet?: string) => srcSetCandidates(srcSet ?? '');

const COTA_1920 = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/COTA_aerial.jpg/1920px-COTA_aerial.jpg';

test('SRL-1: a 5184 px Commons original is never offered as a srcset candidate (only the real bucket thumbs)', () => {
  const r = bestRendition(COTA_1920, { intrinsicWidth: 5184 });
  const list = candidates(r.srcSet);
  assert.ok(list.length > 0);
  assert.ok(list.every((c) => /\/thumb\//.test(c.url)), `only bucket thumbs, got ${r.srcSet}`);
  assert.deepEqual(list.map((c) => c.w), [330, 500, 960, 1280, 1920]);
  // Every label is the thumb's own width.
  for (const c of list) assert.match(c.url, new RegExp(`/${c.w}px-`));
  assert.equal(r.maxWidth, 1920);
});

test('SRL-1: the bucket-scaled width (1920) must not be mistaken for the original width', () => {
  // Old pipeline: commons-image returned width 1920 (scaled) and the page passed it as the
  // original's width, so the 7 MB original was labelled "1920w".
  const image = { fileName: 'COTA_aerial.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:COTA_aerial.jpg', width: 5184, height: 3456, mime: 'image/jpeg', author: 'A', license: 'CC BY 2.0', licenseUrl: null, description: null, categories: [] };
  const credited = commons.creditedCommonsImage(image, 'COTA', 1920)!;
  assert.equal(credited.width, 1920);
  assert.equal(credited.originalWidth, 5184);
  const r = bestRendition(credited.src, { intrinsicWidth: credited.originalWidth });
  assert.ok(!candidates(r.srcSet).some((c) => !/\/thumb\//.test(c.url)), r.srcSet ?? '');
  // The race page passes the original width, not the scaled one.
  const page = source('app/schedule/[season]/[race]/page.tsx');
  assert.match(page, /originalWidth/);
});

test('SRL-1: an original narrower than the top bucket is still the largest candidate, at its true width', () => {
  const r = bestRendition(COTA_1920, { intrinsicWidth: 1500 });
  assert.deepEqual(candidates(r.srcSet).map((c) => c.w), [330, 500, 960, 1280, 1500]);
  assert.ok(candidates(r.srcSet).at(-1)!.url.endsWith('/a/a5/COTA_aerial.jpg'));
});

test('SRL-6: the race-page circuit photo has a small placeholder behind it while the lazy photo loads', () => {
  const page = source('app/schedule/[season]/[race]/page.tsx');
  assert.match(page, /data-photo-placeholder/);
});

test('RES-5: the sharpness check uses the selected candidate\'s real pixels, not the density-corrected naturalWidth', () => {
  const srcSet = 'https://cdn.example/a-320.jpg 320w, https://cdn.example/a-640.jpg 640w';
  // A 640 px file drawn with sizes=175px reports naturalWidth 175 under srcset w.
  assert.equal(pixelWidth({ naturalWidth: 175, currentSrc: 'https://cdn.example/a-640.jpg', srcSet }), 640);
  // Relative candidates resolve against the page URL.
  assert.equal(pixelWidth({ naturalWidth: 40, currentSrc: 'https://apex.test/media/commons/thumb/x/330px-x.jpg', srcSet: '/media/commons/thumb/x/330px-x.jpg 330w', base: 'https://apex.test/drivers' }), 330);
  // No srcset (or a fallback URL outside it): naturalWidth is the real width.
  assert.equal(pixelWidth({ naturalWidth: 1200, currentSrc: 'https://cdn.example/b.jpg' }), 1200);
  assert.equal(pixelWidth({ naturalWidth: 800, currentSrc: 'https://cdn.example/other.jpg', srcSet }), 800);
  // A sharp 1280 px YouTube frame in a 433 px card at dpr 2 is not soft (old code: 432/866 = 0.499 → "soft").
  assert.ok(sharpnessRatio(1280, 433, 2) > 1);
  // A real upscale is caught: a 320 px file in a 333 px frame at dpr 2.
  assert.ok(sharpnessRatio(320, 333, 2) < 0.5);
  // dpr above 2 is capped (phones at dpr 3 are judged at 2x).
  assert.equal(sharpnessRatio(780, 390, 3), 1);
});

test('RES-5: SmartImage measures with pixelWidth (image-measure), never naturalWidth / (width × dpr) directly', () => {
  const smart = source('components/shell/SmartImage.tsx');
  assert.match(smart, /pixelWidth\(/);
  assert.doesNotMatch(smart, /img\.naturalWidth\s*\/\s*\(/);
});

test('TEAMS-4: F1 media Cloudinary renditions go past 1920 (the masters are 3840 px)', () => {
  const car = 'https://media.formula1.com/image/upload/c_fit,w_1280,q_auto,f_auto/common/f1/2026/ferrari/2026ferraricarright.webp';
  const r = bestRendition(car);
  const widths = candidates(r.srcSet).map((c) => c.w);
  assert.ok(widths.includes(2400) && widths.includes(2880) && widths.includes(3840), widths.join(','));
  assert.equal(r.maxWidth, 3840);
});

test('RES-low: table headshots get small Cloudinary candidates (a 40 px slot at dpr 3 needs 120 px, not 320)', () => {
  const head = 'https://media.formula1.com/image/upload/c_fill,g_north,ar_1:1,w_640,q_auto,f_auto/common/f1/2026/mercedes/georus01/2026mercedesgeorus01right.webp';
  const widths = candidates(bestRendition(head).srcSet).map((c) => c.w);
  assert.ok(widths.includes(80) && widths.includes(120) && widths.includes(160), widths.join(','));
  assert.equal(evaluateSizes('40px', 390) * 3, 120);
});

test('HNV-4: YouTube cards get the real 320/480/640/1280 renditions, so small cards never pull maxres', () => {
  const r = bestRendition('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  const list = candidates(r.srcSet);
  assert.deepEqual(list.map((c) => c.w), [320, 480, 640, 1280]);
  assert.deepEqual(list.map((c) => c.url.split('/').at(-1)), ['mqdefault.jpg', 'hqdefault.jpg', 'sddefault.jpg', 'maxresdefault.jpg']);
});

test('HNV-4 + review finding 4: YouTube posters use YouTube\'s own renditions (no optimizer transformation), smallest that covers first', () => {
  const r = bestRendition('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  const o = optimizedRendition(r);
  assert.deepEqual(o, r, 'the optimizer leaves YouTube alone');
  assert.ok(!o.src.startsWith('/_next/image'), o.src);
  assert.deepEqual(candidates(o.srcSet).map((c) => c.w), [320, 480, 640, 1280]);
  // A 358 px phone card at dpr 3 (~1074 px) takes the 1280 px maxres; a desktop card at dpr 1 the 320/480.
  assert.doesNotMatch(source('components/video/VideoPoster.tsx'), /\boptimize\b/);
});

test('HNV-4: list-card publisher photos go through the image optimizer (with the publisher URL as fallback)', () => {
  const wire = source('components/news/WireImage.tsx');
  assert.match(wire, /\boptimize\b/);
  const o = optimizedRendition(bestRendition('https://storage.ghost.io/c/ab/cd/content/images/size/w600/2026/10/photo.jpg'));
  assert.ok(o.src.startsWith('/_next/image?url='));
  // A small-card width (next.config imageSizes) is offered, not only 640+.
  assert.ok(candidates(o.srcSet).some((c) => c.w === 384), o.srcSet ?? '');
  assert.ok(o.fallbacks?.[0]?.startsWith('https://storage.ghost.io/'));
});

test('HNV-4: next.config imageSizes include every optimizer width the renditions use', () => {
  const config = source('next.config.ts');
  const o = optimizedRendition(bestRendition('https://storage.ghost.io/c/ab/cd/content/images/2026/10/photo.jpg'));
  const device = config.match(/deviceSizes:\s*\[([^\]]*)\]/)![1]!.split(',').map(Number);
  const image = config.match(/imageSizes:\s*\[([^\]]*)\]/)![1]!.split(',').map(Number);
  for (const c of candidates(o.srcSet)) assert.ok(device.includes(c.w) || image.includes(c.w), `${c.w} not configured`);
});

test('HNV-5: WireImage only drops a photo on a real error; a slow load keeps loading', () => {
  const wire = source('components/news/WireImage.tsx');
  assert.doesNotMatch(wire, /setTimeout\(\s*fail/);
});

test('DRV-6 + review finding 4: Commons photos use Wikimedia\'s own buckets (no optimizer), capped at the page\'s bucket', () => {
  const thumb = '/media/commons/thumb/a/ab/Nico_Rosberg_2016.jpg/960px-Nico_Rosberg_2016.jpg';
  const o = optimizedRendition(bestRendition(thumb));
  assert.equal(o.src, thumb, 'the bucket the page chose');
  assert.ok(!(o.srcSet ?? '').includes('/_next/image'), o.srcSet ?? '');
  // A 300 px card at dpr 1-2 takes the 330/500 bucket instead of the 960 px file (the DRV-6 weight problem);
  // never a bucket wider than the one the page chose (that one is known to exist for the original).
  assert.deepEqual(candidates(o.srcSet).map((c) => c.w), [330, 500, 960]);
  assert.ok(candidates(o.srcSet).every((c) => c.url.startsWith('/media/commons/thumb/')), o.srcSet ?? '');
  assert.deepEqual(commonsBucketRendition(bestRendition(thumb)), o);
  const smart = source('components/shell/SmartImage.tsx');
  assert.match(smart, /isCommonsThumb\(r\.src\)\) return commonsBucketRendition\(r\)/);
});

test('review finding 4: the optimizer budget (one format, five widths, a 30-day cache, publisher photos only)', () => {
  const config = source('next.config.ts');
  const list = (key: string) => config.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`))![1]!.split(',').map((v) => v.trim()).filter(Boolean);
  assert.deepEqual(list('formats'), ["'image/webp'"], 'one output format: each format doubles the transformations');
  const ttl = Number(config.match(/minimumCacheTTL:\s*([\d_]+)/)![1]!.replace(/_/g, ''));
  assert.ok(ttl >= 2_592_000, `cache optimized photos >= 30 days, got ${ttl}`);
  const widths = [...list('imageSizes'), ...list('deviceSizes')].map(Number).sort((a, b) => a - b);
  assert.deepEqual(widths, [...OPTIMIZER_WIDTHS], 'only the widths the renditions ask for');
  // Hosts with their own renditions never reach the optimizer.
  for (const src of ['https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', 'https://media.formula1.com/image/upload/c_fit,w_960,q_auto/v1/fom-website/2026/Ferrari/car.png', '/media/commons/thumb/a/ab/A.jpg/1280px-A.jpg']) {
    const o = optimizedRendition(bestRendition(src));
    assert.ok(!o.src.startsWith('/_next/image') && !(o.srcSet ?? '').includes('/_next/image'), src);
  }
});

test('sizes evaluator handles media conditions in order', () => {
  assert.equal(evaluateSizes('(max-width: 640px) 45vw, 18vw', 768), 768 * 0.18);
  assert.equal(evaluateSizes('(max-width: 1023px) 45vw, 18vw', 768), 768 * 0.45);
  assert.equal(evaluateSizes('(min-width: 1024px) 50vw, 100vw', 1440), 720);
  assert.equal(evaluateSizes('(max-width: 640px) 44vw, (max-width: 1024px) 22vw, 320px', 1512), 320);
});

/**
 * RES-4 / DRV-5 / DRV-3 / TEAMS-low: `sizes` must not be smaller than the real
 * rendered width (measured in Chrome on 2026-11-01, docs/audit/2026-11-01/fix/images).
 * [file, pattern that finds the sizes string, [viewport, measured css px]...]
 */
const MEASURED: Array<[string, RegExp, Array<[number, number]>]> = [
  ['components/results/LeaderCard.tsx', /<Portrait src=\{row\.headshot[^>]*sizes="([^"]+)"/, [[390, 162], [768, 333], [1024, 172], [1280, 220], [1440, 249], [1512, 262]]],
  ['components/drivers/GridSlot.tsx', /sizes="([^"]+)"/, [[390, 161], [768, 157], [1280, 259], [1440, 292], [1512, 308]]],
  ['app/drivers/(index)/page.tsx', /<LitPortrait src=\{second[^>]*sizes="([^"]+)"/, [[390, 186], [768, 316], [1440, 316], [1512, 316]]],
  ['app/drivers/(index)/page.tsx', /<LitPortrait src=\{leader[^>]*sizes="([^"]+)"/, [[390, 229], [768, 389], [1440, 389]]],
  ['components/drivers/hall/ChampionsHall.tsx', /kind="car" ratio="1200 \/ 264" sizes="([^"]+)"/, [[390, 138], [768, 186], [1024, 113], [1280, 146], [1440, 166], [1512, 175]]],
  ['components/drivers/hall/ChampionsHall.tsx', /className="mt-3" sizes="([^"]+)"/, [[390, 329], [768, 320], [1024, 229], [1280, 212], [1440, 241], [1512, 254]]],
  ['components/teams/TeamHero.tsx', /<CarStage[\s\S]*?: '(\(max-width: 1680px\)[^']+)'/, [[390, 358], [768, 720], [1024, 958], [1280, 1198], [1440, 1348], [1512, 1400]]],
  ['components/teams/carbon/LineUp.tsx', /sizes="([^"]+)"/, [[390, 171], [768, 186], [1024, 244], [1280, 304], [1440, 304]]],
  ['components/news/WireStories.tsx', /sizes="(\(max-width: 640px\) 112px[^"]+)"/, [[390, 112], [768, 160], [1024, 176], [1440, 208]]],
  ['components/video/VideoCards.tsx', /sizes="(\(max-width: 640px\) 100vw[^"]+)"/, [[390, 358], [768, 350], [1024, 304], [1280, 383], [1440, 433], [1512, 456]]],
  ['app/teams/(index)/page.tsx', /sizes="([^"]+)"/, [[390, 358], [768, 720], [1024, 542], [1280, 682], [1440, 770]]],
];

for (const [file, pattern, points] of MEASURED) {
  test(`sizes ≥ rendered width: ${file} ${pattern.source.slice(0, 30)}`, () => {
    const sizes = source(file).match(pattern)?.[1];
    assert.ok(sizes, `no sizes found in ${file}`);
    for (const [vw, rendered] of points) {
      const slot = evaluateSizes(sizes, vw);
      assert.ok(slot >= rendered * 0.95, `${file} @${vw}: sizes gives ${Math.round(slot)} px, rendered ${rendered} px`);
      assert.ok(slot <= rendered * 2.2, `${file} @${vw}: sizes gives ${Math.round(slot)} px, far above rendered ${rendered} px`);
    }
  });
}

test('DRV-3: /drivers has one true LCP priority (the leader); grid cards and P2 are not high priority', () => {
  const page = source('app/drivers/(index)/page.tsx');
  assert.doesNotMatch(page, /<GridSlot[^>]*priority/);
  const priorities = page.match(/\bpriority\b(?!=\{false\})/g) ?? [];
  assert.equal(priorities.length, 1, `expected only the leader to be priority, found ${priorities.length}`);
  // Decorative race-number glyphs never take a high-priority slot.
  assert.doesNotMatch(source('components/ds/Portrait.tsx'), /loading=\{priority \? 'eager'/);
});

test('DRV-3: the phone leader portrait asks for a right-sized candidate (~640 px at dpr 3, not 960)', () => {
  const page = source('app/drivers/(index)/page.tsx');
  const sizes = page.match(/<LitPortrait src=\{leader[^>]*sizes="([^"]+)"/)?.[1];
  assert.ok(sizes);
  // The browser takes the smallest candidate covering slot × dpr: it must be ≤ 720 px (it was 960).
  const leader = 'https://media.formula1.com/image/upload/c_fill,g_north,ar_4:5,w_640,q_auto,f_auto/common/f1/2026/mercedes/georus01/2026mercedesgeorus01right.webp';
  const need = evaluateSizes(sizes, 390) * 3;
  const picked = candidates(bestRendition(leader).srcSet).find((c) => c.w >= need)!;
  assert.ok(picked.w <= 720, `${sizes} → needs ${need} px, picks ${picked.w}w`);
});
