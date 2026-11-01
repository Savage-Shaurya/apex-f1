import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RssItem } from '@apex/api-client/rss';
import { HERO_MAX_SLIDES, HERO_MIN_SLIDES, HERO_POOL, autoAdvances, heroImageWidth, heroPhotoMode, selectHeroSlides, stepSlide } from './news-hero';

// Test fixtures only: shaped like feed rows from the curated F1 newsrooms, never rendered.
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const MIN = 60_000;

function story(n: number, over: Partial<RssItem> = {}): RssItem {
  const ms = NOW - n * 10 * MIN;
  return {
    source: 'PlanetF1',
    title: [
      'Verstappen explains the strategy call that cost him in Mexico',
      'Ferrari confirm floor upgrade for the Brazilian Grand Prix',
      'Norris says McLaren tyre degradation surprised the whole team',
      'Alpine name reserve driver for the final three rounds',
      'Hamilton reflects on his first season in red at Maranello',
      'Stewards clear Russell after the opening lap investigation',
      'Aston Martin outline wind tunnel plan for next year',
      'Piastri targets a stronger qualifying pace in Interlagos',
      'Williams chief praises Albon recovery drive to the points',
      'Haas reveal new technical partnership ahead of Las Vegas',
      'Sauber begin the Audi transition with a fresh livery reveal',
      'Leclerc admits Ferrari still lack rear grip in slow corners',
    ][n] ?? `Story ${n}`,
    link: `https://www.planetf1.com/news/story-number-${n}-unique-slug-text`,
    pubDate: new Date(ms).toUTCString(),
    pubDateMs: ms,
    description: `<p>Standfirst for story ${n}, with &amp; entities and markup.</p>`,
    imageUrl: `https://www.planetf1.com/wp-content/uploads/picture-${n}.jpg`,
    provider: 'rss',
    ...over,
  };
}

test('keeps at most eight stories, newest first', () => {
  const feed = Array.from({ length: 12 }, (_, i) => story(i)).reverse();
  const slides = selectHeroSlides(feed, NOW);
  assert.ok(slides);
  assert.equal(HERO_MAX_SLIDES, 8);
  assert.equal(slides.length, 8);
  assert.deepEqual(slides.map((s) => s.publishedMs), [...slides.map((s) => s.publishedMs)].sort((a, b) => b - a));
  assert.equal(slides[0]!.href, story(0).link);
});

test('every slide carries a real https picture, headline, source, link and time', () => {
  const slides = selectHeroSlides([
    story(0),
    story(1, { imageUrl: undefined }),
    story(2, { imageUrl: 'http://insecure.example/pic.jpg' }),
    story(3),
    story(4),
  ], NOW);
  assert.ok(slides);
  assert.deepEqual(slides.map((s) => s.href), [story(0).link, story(3).link, story(4).link]);
  for (const s of slides) {
    assert.match(s.image, /^https:\/\//);
    assert.ok(s.title.length > 0);
    assert.equal(s.source, 'PlanetF1');
    assert.ok(s.publishedMs > 0);
  }
  assert.equal(slides[0]!.standfirst, 'Standfirst for story 0, with & entities and markup.');
});

test('only Formula 1 stories reach the hero', () => {
  const slides = selectHeroSlides([
    story(0),
    story(1, { title: 'F2 feature race: Antonelli-style rookie wins in Mexico', link: 'https://www.planetf1.com/news/f2-feature-race-rookie-wins' }),
    story(2, { title: 'MotoGP: Marquez wins Malaysian GP', link: 'https://www.motorsport.com/motogp/news/marquez-wins-malaysian-gp/123/', source: 'Motorsport.com', provider: 'newsapi' }),
    story(3),
    story(4),
  ], NOW);
  assert.ok(slides);
  assert.deepEqual(slides.map((s) => s.href), [story(0).link, story(3).link, story(4).link]);
});

test('syndicated copies, non-English rows and future-dated rows are dropped', () => {
  const slides = selectHeroSlides([
    story(0),
    story(1, { link: 'https://www.autosport.com/f1/news/story-number-0-unique-slug-text/99/', source: 'Autosport' }),
    story(2, { language: 'it' }),
    story(3, { pubDateMs: NOW + 3 * 60 * MIN }),
    story(4),
    story(5),
  ], NOW);
  assert.ok(slides);
  assert.deepEqual(slides.map((s) => s.href), [story(0).link, story(4).link, story(5).link]);
});

test('fewer than three usable stories means no carousel (the existing hero shows)', () => {
  assert.equal(HERO_MIN_SLIDES, 3);
  assert.equal(selectHeroSlides([], NOW), null);
  assert.equal(selectHeroSlides([story(0), story(1)], NOW), null);
  assert.equal(selectHeroSlides([story(0), story(1), story(2, { imageUrl: undefined })], NOW), null);
  assert.equal(selectHeroSlides(null, NOW), null);
  assert.ok(selectHeroSlides([story(0), story(1), story(2)], NOW));
});

test('a standfirst that only repeats the headline is left out', () => {
  const s = story(0);
  const slides = selectHeroSlides([{ ...s, description: s.title }, story(1), story(2)], NOW);
  assert.ok(slides);
  assert.equal(slides[0]!.standfirst, null);
});

test('reduced motion, a pause or a single slide stops auto-advance', () => {
  assert.equal(autoAdvances({ reducedMotion: false, paused: false, count: 8 }), true);
  assert.equal(autoAdvances({ reducedMotion: true, paused: false, count: 8 }), false);
  assert.equal(autoAdvances({ reducedMotion: false, paused: true, count: 8 }), false);
  assert.equal(autoAdvances({ reducedMotion: false, paused: false, count: 1 }), false);
});

test('stepping wraps around both ends', () => {
  assert.equal(stepSlide(7, 1, 8), 0);
  assert.equal(stepSlide(0, -1, 8), 7);
  assert.equal(stepSlide(3, 1, 8), 4);
  assert.equal(stepSlide(0, 1, 0), 0);
});

test('hero photos never use the soft guard blindly: the desk runs its own resolution guard (heroPhotoMode)', async () => {
  // SmartImage's guard reads the density-corrected naturalWidth under srcset and would shrink a sharp
  // photo on a Retina screen, so the hero keeps allowUpscale (user, 2026-10-26) and instead decides
  // per slide, from the photo's true width, whether it can fill the frame (audit HNV-2, 2026-11-01).
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./NewsDesk.tsx', import.meta.url), 'utf8');
  const images = source.match(/<SmartImage\b[\s\S]*?\/>/g) ?? [];
  assert.ok(images.length >= 2);
  for (const image of images) assert.match(image, /\ballowUpscale\b/);
  assert.match(source, /heroPhotoMode\(/);
});

// Real publisher URL shapes (image-renditions rules): The Race 2000 px, motorsport.com s6 1200 px,
// ESPN states its size in the file name, WordPress originals are of unknown size.
const GHOST = (n: number) => `https://storage.ghost.io/c/dd/af/x/content/images/2026/10/XPB_${n}_HiRes.jpg`;
const MSPORT = (n: number) => `https://cdn-1.motorsport.com/images/amp/Id${n}/s6/lewis-hamilton-ferrari.jpg`;
const ESPN = 'https://a2.espncdn.com/combiner/i?img=%2Fphoto%2F2026%2F0819%2Fr1703751_1296x729_16%2D9.jpg';

test('the true width of each publisher photo is known where the host states it', () => {
  assert.equal(heroImageWidth(GHOST(1)), 2000);
  assert.equal(heroImageWidth(MSPORT(1)), 1200);
  assert.equal(heroImageWidth(ESPN), 1296);
  assert.equal(heroImageWidth('https://www.planetf1.com/wp-content/uploads/picture-1-1024x683.jpg'), null);
  assert.equal(heroImageWidth('not a url'), null);
});

test('hero slides prefer photos that can fill the frame sharply, from the newest stories only', () => {
  // Newest four are 1200 px motorsport.com photos, the next four 2000 px The Race photos.
  const feed = Array.from({ length: 12 }, (_, n) => story(n, { imageUrl: n < 4 ? MSPORT(n) : n < 8 ? GHOST(n) : MSPORT(n) }));
  const slides = selectHeroSlides(feed, NOW)!;
  assert.equal(slides.length, HERO_MAX_SLIDES);
  // The first slide (the LCP, the one most people see) is the newest sharp photo.
  assert.equal(slides[0]!.image, GHOST(4));
  assert.equal(slides[0]!.imageWidth, 2000);
  // All four sharp stories are in; the rest are filled from the next newest stories.
  const sharp = slides.filter((s) => s.imageWidth === 2000);
  assert.equal(sharp.length, 4);
  // Never older than the newest HERO_POOL stories.
  const oldest = Math.min(...slides.map((s) => s.publishedMs));
  assert.ok(oldest >= NOW - (HERO_POOL - 1) * 10 * MIN);
  // After the lead, newest first.
  const rest = slides.slice(1).map((s) => s.publishedMs);
  assert.deepEqual(rest, [...rest].sort((a, b) => b - a));
});

test('unknown sizes rank between sharp and known-soft photos; soft photos still fill an otherwise short desk', () => {
  // Newest five are known-small, then three unknown WordPress originals, then two sharp ones.
  const feed = Array.from({ length: 10 }, (_, n) => story(n, n < 5 ? { imageUrl: MSPORT(n) } : n >= 8 ? { imageUrl: GHOST(n) } : {}));
  const slides = selectHeroSlides(feed, NOW)!;
  // Both sharp and all unknown photos are in; only the three newest small ones fill the rest.
  assert.deepEqual(slides.map((s) => s.imageWidth), [2000, 1200, 1200, 1200, null, null, null, 2000]);
  assert.ok(!slides.some((s) => s.image === MSPORT(3) || s.image === MSPORT(4)));
  const onlySoft = selectHeroSlides([0, 1, 2].map((n) => story(n, { imageUrl: MSPORT(n) })), NOW)!;
  assert.equal(onlySoft.length, 3);
  assert.deepEqual(onlySoft.map((s) => s.publishedMs), [0, 1, 2].map((n) => NOW - n * 10 * MIN));
});

test('on wide screens a photo too small for the full-bleed frame is framed instead of stretched', () => {
  const frame = { frameWidth: 1440, frameHeight: 760 };
  // 1200 px at 1440 css, dpr 2: 1200 / 2880 = 0.42, visibly soft.
  assert.equal(heroPhotoMode({ imageWidth: 1200, dpr: 2, ...frame }), 'framed');
  assert.equal(heroPhotoMode({ imageWidth: 1296, dpr: 2, ...frame }), 'framed');
  // 1200 px at dpr 1: 0.83, fine.
  assert.equal(heroPhotoMode({ imageWidth: 1200, dpr: 1, ...frame }), 'bleed');
  // 2000 px at 1512 css, dpr 2: 0.66, fine.
  assert.equal(heroPhotoMode({ imageWidth: 2000, dpr: 2, frameWidth: 1512, frameHeight: 800 }), 'bleed');
  // A tall frame needs a wider photo (a 3:2 photo covering it is drawn wider than the frame).
  assert.equal(heroPhotoMode({ imageWidth: 2000, dpr: 1, frameWidth: 1024, frameHeight: 2400 }), 'framed');
  // Unknown size: never guessed soft.
  assert.equal(heroPhotoMode({ imageWidth: null, dpr: 3, ...frame }), 'bleed');
  assert.equal(heroPhotoMode({ imageWidth: 1200, dpr: Number.NaN, ...frame }), 'bleed');
});

test('below lg the photo sits in its own natural-shape frame, edge to edge, with the headline under it', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./NewsDesk.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('./brand-c.css', import.meta.url), 'utf8');
  // The picture frame: its own row, natural 3:2 shape on phones and tablets, full hero from lg.
  assert.match(source, /data-backdrop className="[^"]*\brow-start-1\b[^"]*\baspect-\[3\/2\][^"]*\blg:aspect-auto\b/);
  // The copy: the row under the photo on phones, over it from lg.
  assert.match(source, /data-copy className="[^"]*\brow-start-2\b[^"]*\blg:row-start-1\b/);
  // The full-screen height only applies from lg.
  assert.doesNotMatch(source, /className="relative grid[^"]*\s(?<!lg:)min-h-\[/);
  // The heavy reading scrim only exists where words sit on the photo (lg).
  assert.match(source, /data-scrim className="[^"]*\bhidden\b[^"]*\blg:block\b/);
  // No zoom below lg: the photo is drawn at its sharpest.
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) and \(min-width: 1024px\) \{\s*\.bc-desk-kb/);
});

test('rotating stories never change the hero height: every story has an invisible, inert height holder', async () => {
  // CI quality gate 2026-10-31: CLS 0.024 at 390 px as shorter and longer headlines swapped.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./NewsDesk.tsx', import.meta.url), 'utf8');
  assert.match(source, /slides\.map\(\(story, i\) => \(\s*<div key=\{`hold-\$\{i\}`\} aria-hidden inert className="invisible[^"]*\[grid-area:1\/1\]"/);
  assert.match(source, /aria-live=\{[^}]+\}[^>]*className="\[grid-area:1\/1\]"/);
});
