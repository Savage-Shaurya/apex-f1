import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headlineOverlap, imageIdentity, isSameStory, storySlug, uniqueStories } from './stories';

// Test fixtures only: shaped like the syndicated feed rows seen on 25 Oct 2026, never rendered.
const ms = 'https://www.motorsport.com/f1/news/max-verstappen-puzzled-by-q3-grip-loss-but-austin-shows-how-far-red-bull-has-progressed/10868113/?utm_source=RSS';
const as = 'https://www.autosport.com/f1/news/max-verstappen-puzzled-by-q3-grip-loss-but-austin-shows-how-far-red-bull-has-progressed/10868230/?utm_source=RSS';

test('slugs ignore numeric ids and tracking queries', () => {
  assert.equal(storySlug(ms), 'max-verstappen-puzzled-by-q3-grip-loss-but-austin-shows-how-far-red-bull-has-progressed');
  assert.equal(storySlug(ms), storySlug(as));
  assert.equal(storySlug('https://example.com/2026/10/25/'), null);
  assert.equal(storySlug('not a url'), null);
});

test('the same picture on another CDN shard is one picture', () => {
  assert.equal(
    imageIdentity('https://cdn-3.motorsport.com/images/amp/2QedgVN2/s6/max-verstappen-red-bull-racing.jpg'),
    imageIdentity('https://cdn-9.motorsport.com/images/amp/2QedgVN2/s6/max-verstappen-red-bull-racing.jpg?x=1'),
  );
  assert.notEqual(
    imageIdentity('https://cdn-3.motorsport.com/images/amp/2QedgVN2/s6/a.jpg'),
    imageIdentity('https://cdn-3.motorsport.com/images/amp/0Zq8dLd6/s6/a.jpg'),
  );
});

test('reworded syndicated headlines are the same story; different stories are not', () => {
  const a = 'Max Verstappen reacts to COTA boss: He can drive my car, after five laps he won\'t be able to walk';
  const b = 'Max Verstappen responds to COTA boss: He can drive my car, after five laps he won\'t be able to walk';
  assert.ok(headlineOverlap(a, b) >= 0.7);
  assert.ok(headlineOverlap('Antonelli admits it feels different ahead of first chance to seal title', 'How F1 2026 team-mates are comparing in qualifying') < 0.3);
});

test('uniqueStories keeps the first copy and the feed order', () => {
  const rows = [
    { href: ms, title: 'Verstappen puzzled by Q3 grip loss', image: null },
    { href: 'https://www.the-race.com/formula-1/how-f1-2026-team-mates-are-comparing-in-qualifying/', title: 'How F1 2026 team-mates are comparing in qualifying', image: null },
    { href: as, title: 'Verstappen puzzled by Q3 grip loss but Austin shows progress', image: null },
  ];
  assert.deepEqual(uniqueStories(rows).map((r) => r.href), [rows[0]!.href, rows[1]!.href]);
  assert.equal(isSameStory(rows[0]!, rows[1]!), false);
});
