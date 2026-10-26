import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseSyndicated, isSyndicatedPair, slugWords } from './news-format';

const T = Date.parse('2026-10-25T12:00:00Z');
const story = (source: string, href: string, minutesAgo: number, extra: { summary?: string; imageUrl?: string | null; title?: string } = {}) => ({
  title: extra.title ?? href,
  href,
  source,
  publishedMs: T - minutesAgo * 60_000,
  summary: extra.summary,
  imageUrl: extra.imageUrl ?? null,
});

// Real pairs seen on /latest on 2026-10-25 (Motorsport Network syndication).
const msPuzzled = story('Motorsport.com', 'https://www.motorsport.com/f1/news/max-verstappen-puzzled-by-q3-grip-loss-but-austin-shows-how-far-red-bull-ha/10868070/', 0, { imageUrl: 'https://cdn-1.motorsport.com/a.jpg' });
const asPuzzled = story('Autosport', 'https://www.autosport.com/f1/news/max-verstappen-puzzled-by-q3-grip-loss-but-austin-shows-how-far-red-bull-has/10868071/', 1);
const msCota = story('Motorsport.com', 'https://www.motorsport.com/f1/news/max-verstappen-reacts-to-cota-boss-he-can-drive-my-car-after-five-laps-he-w/1/', 30);
const asCota = story('Autosport', 'https://www.autosport.com/f1/news/max-verstappen-responds-to-cota-boss-he-can-drive-my-car-after-five-laps-he-/2/', 31);
const standfirst = 'Andrea Kimi Antonelli says Mercedes is finally seeing the results of its upgrades after a surprise pole position at the Circuit of the Americas.';
const asPole = story('Autosport', 'https://www.autosport.com/f1/news/antonelli-pole-shows-mercedes-is-seeing-results-of-car-upgrades/10868072/', 60, { summary: standfirst });
const msPole = story('Motorsport.com', 'https://www.motorsport.com/f1/news/kimi-antonelli-delivers-austin-surprise-pole-in-tricky-mercedes-finally-wer/3/', 62, { summary: standfirst, imageUrl: 'https://cdn-1.motorsport.com/b.jpg' });

test('slugWords keeps the significant words of the article slug', () => {
  assert.deepEqual(slugWords('https://www.the-race.com/formula-1/f1-us-gp-qualifying-2026-winners-losers/'), ['us', 'qualifying', 'winners', 'losers']);
  assert.deepEqual(slugWords('not a url'), []);
});

test('syndicated copies are recognised by slug or by identical standfirst', () => {
  assert.equal(isSyndicatedPair(msPuzzled, asPuzzled), true);
  assert.equal(isSyndicatedPair(msCota, asCota), true);
  assert.equal(isSyndicatedPair(asPole, msPole), true);
});

test('different stories, same-publisher pairs and old copies stay separate', () => {
  const grid = story('The Race', 'https://www.the-race.com/formula-1/f1-2026-united-states-grand-prix-starting-grid-engine-penalties/', 5);
  const results = story('Motorsport.com', 'https://www.motorsport.com/f1/news/united-states-grand-prix-race-results-engine-penalties/9/', 6);
  assert.equal(isSyndicatedPair(grid, results), false);
  const sameHost = story('Motorsport.com', msPuzzled.href.replace('10868070', '999'), 3);
  assert.equal(isSyndicatedPair(msPuzzled, sameHost), false);
  const old = { ...asPuzzled, publishedMs: T - 3 * 86_400_000 };
  assert.equal(isSyndicatedPair(msPuzzled, old), false);
  // Short boilerplate standfirsts do not merge stories.
  const a = story('RaceFans', 'https://www.racefans.net/2026/10/25/one-story/', 1, { summary: 'Read more.' });
  const b = story('The Race', 'https://www.the-race.com/formula-1/other-story/', 2, { summary: 'Read more.' });
  assert.equal(isSyndicatedPair(a, b), false);
});

test('collapseSyndicated keeps order, prefers the copy with a picture and lists the others', () => {
  const other = story('The Race', 'https://www.the-race.com/formula-1/how-f1-2026-team-mates-are-comparing-in-qualifying/', 10);
  const out = collapseSyndicated([msPuzzled, asPuzzled, other, msCota, asCota, asPole, msPole]);
  assert.deepEqual(out.map((s) => s.href), [msPuzzled.href, other.href, msCota.href, msPole.href]);
  assert.deepEqual(out[0]!.alsoAt, [{ source: 'Autosport', href: asPuzzled.href }]);
  assert.deepEqual(out[1]!.alsoAt, []);
  // The pole story is shown from Motorsport.com, the copy with a picture.
  assert.deepEqual(out[3]!.alsoAt, [{ source: 'Autosport', href: asPole.href }]);
});

test('a publisher filter shows that publisher’s own copy, with the other listed under Also at', () => {
  const out = collapseSyndicated([msPuzzled, asPuzzled, asPole, msPole], 'Autosport');
  assert.deepEqual(out.map((s) => s.href), [asPuzzled.href, asPole.href]);
  assert.deepEqual(out[0]!.alsoAt, [{ source: 'Motorsport.com', href: msPuzzled.href }]);
  // A publisher that did not run a copy changes nothing.
  assert.deepEqual(collapseSyndicated([msPuzzled, asPuzzled], 'RaceFans').map((s) => s.href), [msPuzzled.href]);
});
