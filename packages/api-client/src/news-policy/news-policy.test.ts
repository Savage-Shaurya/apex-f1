import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyNewsPolicy,
  classifyNewsItem,
  dropNearDuplicates,
  emptyPolicyReport,
  headlineSimilarity,
  isF1VideoTitle,
  type ClassifiableNewsItem,
  type NewsProviderKind,
} from './index';

// Every headline below was returned by the live providers on 2026-10-25
// (audit docs/audit/2026-10-25/home-news.md and the fx-news provider dump).
function row(provider: NewsProviderKind, title: string, link: string, extra: Partial<ClassifiableNewsItem> = {}): ClassifiableNewsItem & { source: string } {
  return { provider, title, link, source: `fixture-${provider}`, ...extra };
}

const OFF_TOPIC: Array<[NewsProviderKind, string, string, string]> = [
  ['newsapi', 'High school football: Friday\'s scores', 'https://sports.yahoo.com/articles/high-school-football-friday-scores-0400.html', 'blocked-source'],
  ['newsdata', 'Cincinnati high school football scores: Week 10 playoff results', 'https://www.cincinnati.com/story/sports/high-school/football/2026/10/24/cincinnati-high-school-football-scores/', 'blocked-source'],
  ['newsapi', 'World Series 2026: Rays come up short on coin-flip plays and defensive near-misses in Game 2', 'https://sports.yahoo.com/mlb/article/world-series-2026-rays.html', 'blocked-source'],
  ['newsapi', 'IND vs NZ 2nd T20I 2026 live scorecard, toss winner, winning probability, result and highlights', 'https://www.cricketnews.com/ind-vs-nz-2nd-t20i-2026', 'other-sport'],
  // The audit recorded only the card title for this one; the link host is a placeholder.
  ['newsdata', 'Gratuity calculator', 'https://publisher.invalid/gratuity-calculator', 'low-value'],
  ['newsapi', 'U.S. birth rate drops to record low, but older women are having more babies', 'https://www.npr.org/2026/10/24/birth-rate', 'unlisted-source'],
  ['newsapi', 'The Leica Q3 43 Formula 1 Edition: Vroom Vroom', 'https://luminous-landscape.com/leica-q3-43-formula-1-edition/', 'unlisted-source'],
  ['gnews', 'Simon Sinek’s ‘3+1’ formula breaks down relationship compatibility', 'https://www.foxnews.com/lifestyle/simon-sinek-formula', 'unlisted-source'],
  ['newsapi', 'Mercedes-AMG GT SUV looks to outsprint its electric rivals', 'https://newatlas.com/automotive/mercedes-amg-gt-suv/', 'unlisted-source'],
  ['newsapi', 'lapbox 0.2.0.dev0', 'https://pypi.org/project/lapbox/0.2.0.dev0/', 'unlisted-source'],
  ['newsapi', 'Consecutive defeats from Canada put Red Roses on first rugby losing streak in a decade', 'https://sports.yahoo.com/rugby/red-roses.html', 'blocked-source'],
  ['newsdata', 'NASCAR-O\'Reilly The Progress Group 250 Results', 'https://www.cadillacnews.com/sports/nascar-oreilly-250-results', 'other-series'],
  ['newsapi', 'F1 legend Max Verstappen chooses between Barcelona and Real Madrid ahead of El Clasico', 'https://barcauniversal.com/f1-verstappen-el-clasico/', 'other-sport'],
  ['currents', 'F1 superstar Max Verstappen picks his winner for El Clasico between Barcelona and Real Madrid', 'https://www.sportskeeda.com/f1/verstappen-el-clasico', 'other-sport'],
  ['currents', 'Ask r/formula1 Anything - Daily Discussion Thread', 'https://www.reddit.com/r/formula1/comments/abc/', 'blocked-source'],
  ['currents', 'Mercedes Driver Kimi Antonelli Earns Surprise Pole For The US Grand Prix As He Chases The Title', 'https://sports.ndtv.com/formula-1/mercedes-driver-kimi-antonelli-earns-surprise-pole', 'blocked-source'],
  ['newsdata', 'Antonelli takes US pole on weekend he can win title - BBC', 'https://news.google.com/rss/articles/CBMiabc', 'blocked-source'],
  ['newsapi', 'F1 qualifying free live stream: How to watch 2026 United States Grand Prix and start time', 'https://www.sportingnews.com/us/formula-1/news/f1-qualifying-live-stream', 'low-value'],
  ['newsdata', 'JK Tyre National Karting Championship: Round 4 results', 'https://www.motorsport.com/kart/news/jk-tyre-round-4/', 'other-series'],
  ['rss', 'Palou gets home race as IndyCar adds new Spanish round to 2027 calendar | IndyCar', 'https://www.racefans.net/2026/10/24/palou-home-race-indycar/', 'other-series'],
  ['rss', 'Bortoleto\'s successor? Formula 2 title decider set for Abu Dhabi', 'https://www.the-race.com/formula-2/title-decider/', 'other-series'],
  ['rss', 'F1 Academy United States Grand Prix Race 2 | Highlights', 'https://www.motorsport.com/f1-academy/news/race-2/', 'other-series'],
  ['newsdata', 'Marquez seals MotoGP title at Valencia Grand Prix', 'https://www.crash.net/motogp/news/marquez-title', 'other-series'],
  ['gnews', 'Formula E confirms new Miami round for Season 13', 'https://www.motorsport.com/formula-e/news/miami/', 'other-series'],
];

test('every off-topic headline seen on 2026-10-25 is rejected with the right reason', () => {
  for (const [provider, title, link, reason] of OFF_TOPIC) {
    const verdict = classifyNewsItem(row(provider, title, link));
    assert.equal(verdict.allowed, false, title);
    assert.equal(!verdict.allowed && verdict.reason, reason, title);
  }
});

test('real F1 stories from curated feeds and allowlisted publishers are kept', () => {
  const kept: Array<[NewsProviderKind, string, string, string | undefined]> = [
    ['rss', 'Why F1 is so sure its Apple TV deal is working', 'https://www.the-race.com/formula-1/apple-tv-deal/', undefined],
    ['rss', 'Loss of pace in Q3 &#8216;something we have to look at because it&#8217;s very odd&#8217; | Formula 1', 'https://www.racefans.net/2026/10/25/loss-of-pace-q3/', undefined],
    ['rss', 'Video: First trailer for &#8216;Hunt: We need to talk about James&#8217; revealed | Briefs', 'https://www.racefans.net/2026/10/24/hunt-trailer/', undefined],
    ['currents', 'Lewis Hamilton praises United States Grand Prix: \'Unbelievable, one of the best overall circuits\'', 'https://www.espn.com/f1/story/_/id/1/hamilton', 'ESPN'],
    ['currents', 'Kimi Antonelli ecstatic with first pole since July at United States GP: \'It\'s good to be back\'', 'https://www.espn.com/f1/story/_/id/2/antonelli', 'ESPN'],
    ['newsdata', 'F1 starting grid: What is the grid for the 2026 United States Grand Prix?', 'https://www.planetf1.com/news/f1-starting-grid-us-gp', 'PlanetF1'],
    ['newsapi', 'Leclerc tops both Austin practices but warns Verstappen and Antonelli have more in hand', 'https://www.gpblog.com/en/news/leclerc-tops', 'GPblog'],
    ['gnews', 'Carlos Sainz \'not expecting miracles\' after Williams Racing suffer disappointing start to weekend', 'https://www.formula1.com/en/latest/article/sainz', 'Formula 1'],
    ['newsdata', 'Ni Verstappen, ni Russell, ni Leclerc: este es el piloto que podría coronarse campeón de F1 en Austin', 'https://www.marca.com/motor/formula1/2026/10/24/piloto.html', 'Marca'],
    ['newsapi', 'Red Bull identifies two "key focus" areas after Max Verstappen\'s promising start in Austin', 'https://www.autosport.com/f1/news/red-bull-key-focus/', 'Autosport'],
    ['rss', 'F1 team signs Formula 2 champion for 2027', 'https://www.the-race.com/formula-1/f2-champion-signed/', undefined],
  ];
  for (const [provider, title, link, publisher] of kept) {
    const verdict = classifyNewsItem(row(provider, title, link));
    assert.equal(verdict.allowed, true, title);
    assert.equal(verdict.allowed && verdict.publisher, publisher ?? undefined, title);
  }
});

test('general outlets need an explicit F1 term; summaries can support F1 vocabulary in the headline', () => {
  assert.deepEqual(classifyNewsItem(row('newsapi', 'Mercedes reveal new road car', 'https://www.reuters.com/business/autos/mercedes-road-car')), { allowed: false, reason: 'not-f1' });
  assert.deepEqual(
    classifyNewsItem(row('newsapi', 'Antonelli edges Verstappen to pole', 'https://www.reuters.com/sports/antonelli-pole', { description: 'Mercedes driver claims pole for the Formula One United States Grand Prix.' })),
    { allowed: true, publisher: 'Reuters' },
  );
});

test('IndyCar category tags reject a RaceFans brief even without a series name in the headline', () => {
  assert.deepEqual(classifyNewsItem(row('rss', 'Palou gets home race in Spain', 'https://www.racefans.net/2026/10/24/palou/', { categories: ['IndyCar'] })), { allowed: false, reason: 'other-series' });
  assert.equal(classifyNewsItem(row('rss', 'Norris says he did a c*** job', 'https://www.racefans.net/2026/10/25/norris/', { categories: ['2026 F1 season', 'Formula 1', 'Lando Norris'] })).allowed, true);
});

test('invalid links never render', () => {
  for (const link of ['', 'javascript:alert(1)', 'ftp://example.com/a', 'https://user:pass@www.espn.com/f1']) {
    assert.deepEqual(classifyNewsItem(row('newsapi', 'Formula 1 news', link)), { allowed: false, reason: 'invalid-link' });
  }
});

test('policy application relabels API rows, drops API copies of curated newsrooms and counts every rejection', () => {
  const report = emptyPolicyReport();
  const out = applyNewsPolicy([
    row('rss', 'The unexpected issue Honda faced with upgraded F1 power unit', 'https://www.autosport.com/f1/news/honda-issue/'),
    row('newsapi', 'The unexpected problem Honda encountered despite its second F1 power unit upgrade', 'https://www.autosport.com/f1/news/honda-problem/'),
    row('currents', 'Kimi Antonelli ecstatic with first pole since July at United States GP', 'https://www.espn.com/f1/story/_/id/2/antonelli'),
    row('newsapi', 'High school football: Friday\'s scores', 'https://sports.yahoo.com/hs.html'),
    row('newsapi', 'IND vs NZ 2nd T20I 2026 live scorecard', 'https://www.cricketnews.com/ind-nz'),
  ], report);
  assert.deepEqual(out.map((item) => item.source), ['fixture-rss', 'ESPN']);
  assert.deepEqual(report, { considered: 5, kept: 2, rejected: { duplicate: 1, 'blocked-source': 1, 'other-sport': 1 } });
});

test('near-duplicate headlines inside two days collapse to the first, trusted copy', () => {
  const t = Date.UTC(2026, 9, 25);
  assert.ok(headlineSimilarity('Antonelli on US GP pole as Ferrari challenge falls apart', 'Antonelli on US GP pole as the Ferrari challenge falls apart') >= 0.6);
  assert.ok(headlineSimilarity('Why F1 is so sure its Apple TV deal is working', 'Hamilton leads final practice after Leclerc lap deletion') < 0.2);
  const kept = dropNearDuplicates([
    { title: 'Antonelli on US GP pole as Ferrari challenge falls apart', link: 'https://www.the-race.com/a', pubDateMs: t },
    { title: 'Antonelli on US GP pole as the Ferrari challenge falls apart', link: 'https://www.gpblog.com/b', pubDateMs: t + 3_600_000 },
    { title: 'Antonelli on US GP pole as Ferrari challenge falls apart', link: 'https://www.gpblog.com/c', pubDateMs: t + 5 * 86_400_000 },
  ]);
  assert.deepEqual(kept.map((item) => item.link), ['https://www.the-race.com/a', 'https://www.gpblog.com/c']);
});

test('curated-channel video titles drop other series but keep F1 content', () => {
  assert.equal(isF1VideoTitle('F1 Academy United States Grand Prix Race 2 | Highlights'), false);
  assert.equal(isF1VideoTitle('What Does a GT4 Championship Really Cost? 🏁'), false);
  assert.equal(isF1VideoTitle('Kimi Antonelli, Max Verstappen & Isack Hadjar react to United States GP Qualifying'), true);
  assert.equal(isF1VideoTitle('Building an F1 Strategy from the Bare Basics'), true);
  assert.equal(isF1VideoTitle('My 2026 Austin Grand Prix F1 Preview & Predictions'), true);
});
