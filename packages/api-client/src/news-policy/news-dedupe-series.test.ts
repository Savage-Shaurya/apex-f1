import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyNewsItem, dropNearDuplicates, headlineSimilarity, isNearDuplicateHeadline, linkSeries } from './index';

const t = Date.parse('2026-10-25T12:00:00Z');

test('D2-CODE-QUALITY-2: different sessions, races or practice numbers are never collapsed into one story', () => {
  const pairs: Array<[string, string]> = [
    ['Norris wins sprint at the United States Grand Prix', 'Norris wins the United States Grand Prix'],
    ['Leclerc tops FP1 at the Mexico City Grand Prix', 'Leclerc tops FP2 at the Mexico City Grand Prix'],
    ['Leclerc fastest in Practice 1 in Mexico', 'Leclerc fastest in Practice 2 in Mexico'],
    ['Verstappen takes pole for the Brazilian Grand Prix', 'Verstappen takes pole for the Mexican Grand Prix'],
    ['Piastri leads McLaren one-two in Austin sprint qualifying', 'Piastri leads McLaren one-two in Austin qualifying'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(headlineSimilarity(a, b) >= 0.5, `fixture pair should look similar: ${a} | ${b}`);
    assert.equal(isNearDuplicateHeadline(a, b), false, `${a} | ${b}`);
  }
  const kept = dropNearDuplicates(pairs.flat().map((title, index) => ({ title, link: `https://www.formula1.com/${index}`, pubDateMs: t + index })));
  assert.equal(kept.length, pairs.length * 2);
});

test('syndicated copies of one story still collapse', () => {
  assert.equal(isNearDuplicateHeadline('Antonelli on US GP pole as Ferrari challenge falls apart', 'Antonelli on US GP pole as the Ferrari challenge falls apart'), true);
  assert.equal(isNearDuplicateHeadline('Hamilton handed five-place grid penalty for Mexico', 'Hamilton handed five-place grid penalty for Mexico City Grand Prix'), true);
});

test('D2-CODE-QUALITY-9: MotoGP Grand Prix headlines from multi-series outlets are rejected', () => {
  const reject = [
    { title: 'Marquez wins Malaysian GP to extend points lead', link: 'https://www.motorsport.com/motogp/news/marquez-wins-malaysian-gp/123/' },
    { title: 'Marquez wins Malaysian GP to extend points lead', link: 'https://www.crash.net/news/123/marquez-wins' },
    { title: 'Bagnaia takes pole for the Malaysian Grand Prix', link: 'https://www.autosport.com/news/bagnaia-pole/' },
    { title: 'Bagnaia takes pole for the Malaysian Grand Prix', link: 'https://www.espn.com/racing/story/123' },
  ];
  for (const item of reject) assert.equal(classifyNewsItem({ ...item, provider: 'gnews' }).allowed, false, `${item.title} ${item.link}`);
  const allow = [
    { title: 'Verstappen wins Mexican GP', link: 'https://www.motorsport.com/f1/news/verstappen-wins/1/' },
    { title: 'Mexican GP: what we learned', link: 'https://www.autosport.com/f1/news/what-we-learned/' },
    { title: 'Norris takes pole in Austin', link: 'https://www.racer.com/2026/10/24/norris-pole/' },
    { title: 'Formula 1 confirms 2027 calendar', link: 'https://www.espn.com/f1/story/1' },
  ];
  for (const item of allow) assert.equal(classifyNewsItem({ ...item, provider: 'gnews' }).allowed, true, `${item.title} ${item.link}`);
  assert.equal(linkSeries('https://www.motorsport.com/motogp/news/x/'), 'other');
  assert.equal(linkSeries('https://www.the-race.com/formula-1/x/'), 'f1');
  assert.equal(linkSeries('https://www.racefans.net/2026/10/25/x/'), null);
});
