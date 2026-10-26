import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RssItem } from '@apex/api-client/rss';
import { HERO_MAX_SLIDES, HERO_MIN_SLIDES, autoAdvances, selectHeroSlides, stepSlide } from './news-hero';

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

test('every hero photo fills the full-bleed frame, even on a 2x screen (no scale-down strip at the edge)', async () => {
  // Publisher photos top out at 1200 px; without allowUpscale SmartImage scales them down on
  // Retina screens and the striped placeholder shows beside the photo (user, 2026-10-26).
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./NewsDesk.tsx', import.meta.url), 'utf8');
  const images = source.match(/<SmartImage\b[\s\S]*?\/>/g) ?? [];
  assert.ok(images.length >= 2);
  for (const image of images) assert.match(image, /\ballowUpscale\b/);
});
