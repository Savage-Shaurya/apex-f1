import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { championPortraits } from './champion-portraits';

/**
 * Review 2026-11-01 follow-up: like the team cars, a failed champion portrait
 * lookup (Wikimedia 429, timeout) must never be cached for a day. The cached
 * reader throws on failure; championPortraits keeps the other portraits and
 * marks the render degraded once (outageConnection: kept 60 s, then retried).
 */
const people = [
  { key: 'senna', wikiUrl: 'https://en.wikipedia.org/wiki/Ayrton_Senna', name: 'Ayrton Senna' },
  { key: 'prost', wikiUrl: 'https://en.wikipedia.org/wiki/Alain_Prost', name: 'Alain Prost' },
  { key: 'lauda', wikiUrl: 'https://en.wikipedia.org/wiki/Niki_Lauda', name: 'Niki Lauda' },
];
const credit = { author: 'A', license: 'CC BY-SA 4.0', licenseUrl: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg', title: 'X' };

test('a failed lookup keeps the other portraits and marks the render degraded once', async () => {
  let failures = 0;
  const map = await championPortraits(people, 2, {
    read: async (url) => {
      if (!url.endsWith('Senna')) throw new Error('Commons 429');
      return { src: '/media/commons/a/ab/Senna.jpg', credit } as never;
    },
    onFailure: async () => { failures += 1; },
  });
  assert.deepEqual([...map.keys()], ['senna']);
  assert.equal(failures, 1);
});

test('no failure, no degraded mark', async () => {
  let failures = 0;
  await championPortraits(people, 3, { read: async () => null, onFailure: async () => { failures += 1; } });
  assert.equal(failures, 0);
});

test('the cached reader asks Commons strictly and never swallows a failure into a cached null', () => {
  const src = readFileSync(new URL('./champion-portraits.ts', import.meta.url), 'utf8');
  const cached = src.slice(src.indexOf('unstable_cache('), src.indexOf("['apex-champion-portrait"));
  assert.match(cached, /strict: true/);
  assert.doesNotMatch(cached, /catch\s*\{[\s\S]*?return null/);
  assert.doesNotMatch(cached, /if \(!summary\) return null/, 'a failed Wikipedia read must not become a cached null');
});
