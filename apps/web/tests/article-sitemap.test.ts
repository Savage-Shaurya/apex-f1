import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeArticleSitemapRange, encodeArticleSitemapRange } from '@apex/db';
import { articleSitemapResponse, sitemapIndexResponse } from '../lib/sitemap-xml';
import { GET as shard } from '../app/sitemaps/articles/[range]/route';

const from = '10000000-0000-4000-8000-000000000001';
const until = '20000000-0000-4000-8000-000000000001';
test('sitemap ranges preserve UUID intervals and reject malformed or reversed bounds', () => {
  for (const range of [{ from: null, until: null }, { from: null, until }, { from, until }, { from, until: null }]) assert.deepEqual(decodeArticleSitemapRange(encodeArticleSitemapRange(range)), range);
  for (const invalid of ['', 'start.end.extra', `${until}.${from}`, `${from}.${from}`, '../../private.end', 'ABCDEF00-0000-4000-8000-000000000001.end']) assert.equal(decodeArticleSitemapRange(invalid), null);
});
test('index advertises every range and shard XML encodes legacy slugs rather than interpolating them', async () => {
  const ranges = [{ from: null, until }, { from: until, until: null }];
  const index = await sitemapIndexResponse('https://apex.invalid', ranges).text();
  assert.equal((index.match(/<sitemap>/g) ?? []).length, 3); assert(index.includes('/sitemap.xml')); assert(index.includes(`${until}.end.xml`));
  const response = articleSitemapResponse('https://apex.invalid', [{ slug: 'a/<script>?x&y', updatedAt: new Date('2026-10-04T00:00:00Z') }]);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.text(); assert(body.includes('a%2F%3Cscript%3E%3Fx%26y')); assert.equal(body.includes('<script>'), false); assert(body.includes('2026-10-04T00:00:00.000Z'));
});
test('malformed public shard tokens return 404 before accessing storage', async () => {
  for (const token of ['start.end', 'invalid.xml', '../private.xml']) assert.equal((await shard(new Request('https://apex.invalid'), { params: Promise.resolve({ range: token }) })).status, 404);
});
test('XML maps reject too many URLs instead of silently truncating publication coverage', () => {
  const entry = { slug: 'fixture', updatedAt: new Date('2026-10-04T00:00:00Z') };
  assert.throws(() => articleSitemapResponse('https://apex.invalid', Array(50_001).fill(entry)), /XML limits/);
  assert.throws(() => sitemapIndexResponse('https://apex.invalid', Array(50_000).fill({ from: null, until: null })), /XML limits/);
});
