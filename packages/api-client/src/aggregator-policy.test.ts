import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getAggregatedF1NewsResult } from './aggregator';

const keys = ['GUARDIAN_API_KEY', 'GNEWS_API_KEY', 'NEWSDATA_API_KEY', 'NEWSAPI_KEY', 'CURRENTS_API_KEY'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
beforeEach(() => { for (const key of keys) delete process.env[key]; });
afterEach(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });

const rss = (items: Array<[string, string]>) => `<rss version="2.0"><channel><title>Fixture</title>${items.map(([title, link]) => `<item><title>${title}</title><link>${link}</link><pubDate>Sun, 25 Oct 2026 01:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const feed = rss([
  ['Antonelli on US GP pole as Ferrari challenge falls apart', 'https://www.the-race.com/formula-1/antonelli-pole/'],
  ['Palou gets home race as IndyCar adds new Spanish round to 2027 calendar | IndyCar', 'https://www.racefans.net/2026/10/24/palou/'],
]);

test('a rejected Guardian key is reported as rejected, not as a temporary outage', async () => {
  process.env.GUARDIAN_API_KEY = 'disposable-test-key';
  const result = await getAggregatedF1NewsResult({ fetchImpl: async (url) => new URL(String(url)).hostname === 'content.guardianapis.com' ? new Response('{}', { status: 401 }) : new Response(feed) });
  assert.equal(result.sources.find((s) => s.source === 'The Guardian')?.state, 'rejected');
  assert.equal(result.availability, 'available');
  assert.equal(JSON.stringify(result).includes('disposable-test-key'), false);
});

test('off-topic, blocked and duplicate rows from keyword APIs never reach the result; allowed rows carry the publisher name', async () => {
  process.env.NEWSAPI_KEY = 'disposable-test-key';
  const newsapi = { status: 'ok', totalResults: 4, articles: [
    { source: { id: null, name: 'Yahoo Entertainment' }, title: "High school football: Friday's scores", url: 'https://sports.yahoo.com/hs.html', publishedAt: '2026-10-25T00:00:00Z', description: 'Scores', urlToImage: null, author: null, content: null },
    { source: { id: null, name: 'Cricketnews.com' }, title: 'IND vs NZ 2nd T20I 2026 live scorecard', url: 'https://www.cricketnews.com/ind-nz', publishedAt: '2026-10-25T00:00:00Z', description: 'Cricket', urlToImage: null, author: null, content: null },
    { source: { id: null, name: 'GPblog.com' }, title: 'Leclerc tops both Austin practices but warns Verstappen and Antonelli have more in hand', url: 'https://www.gpblog.com/en/news/leclerc', publishedAt: '2026-10-24T00:00:00Z', description: 'F1', urlToImage: null, author: null, content: null },
    { source: { id: null, name: 'GPblog.com' }, title: 'Antonelli on US GP pole as the Ferrari challenge falls apart', url: 'https://www.gpblog.com/en/news/antonelli', publishedAt: '2026-10-25T02:00:00Z', description: 'F1', urlToImage: null, author: null, content: null },
  ] };
  const result = await getAggregatedF1NewsResult({ fetchImpl: async (url) => new URL(String(url)).hostname === 'newsapi.org' ? Response.json(newsapi) : new Response(feed) });
  const titles = result.items.map((item) => item.title);
  assert.ok(titles.includes('Antonelli on US GP pole as Ferrari challenge falls apart'));
  assert.ok(!titles.some((t) => /IndyCar|High school|T20I/.test(t)));
  assert.ok(!titles.includes('Antonelli on US GP pole as the Ferrari challenge falls apart'), 'near-duplicate API copy dropped');
  assert.equal(result.items.find((item) => item.link.includes('gpblog.com/en/news/leclerc'))?.source, 'GPblog');
  assert.ok((result.policy.rejected['blocked-source'] ?? 0) >= 1);
  assert.ok((result.policy.rejected['other-sport'] ?? 0) >= 1);
  assert.ok((result.policy.rejected['other-series'] ?? 0) >= 1);
  assert.ok((result.policy.rejected.duplicate ?? 0) >= 1);
});
