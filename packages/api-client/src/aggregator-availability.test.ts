import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { getAggregatedF1News, getAggregatedF1NewsResult } from './aggregator';
import { F1_RSS_SOURCES, getF1NewsFeed } from './rss';
import { ProviderError } from './transport';
import { hasXmlDoctype } from './rss/xml-policy';

const keys = ['GUARDIAN_API_KEY','GNEWS_API_KEY','NEWSDATA_API_KEY','NEWSAPI_KEY','CURRENTS_API_KEY'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
beforeEach(() => { for (const key of keys) delete process.env[key]; });
afterEach(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
const empty = '<rss version="2.0"><channel><title>Fixture feed</title></channel></rss>';
const story = '<rss version="2.0"><channel><title>Fixture feed</title><item><title>Formula 1 fixture report</title><link>https://publisher.invalid/report</link><pubDate>Sun, 04 Oct 2026 00:00:00 GMT</pubDate><description>Disposable provider fixture.</description></item></channel></rss>';
const unavailable: typeof fetch = async () => new Response('Fixture unavailable', { status: 503 });

test('total provider failure is unavailable while absent credentials never count as successful empty sources', async () => {
  const result = await getAggregatedF1NewsResult({ fetchImpl: unavailable });
  assert.equal(result.availability, 'unavailable'); assert.deepEqual(result.items, []);
  assert.equal(result.sources.filter((source) => source.state === 'unavailable').length, 4);
  assert.equal(result.sources.filter((source) => source.state === 'unconfigured').length, 5);
  assert.equal(result.sources.some((source) => source.state === 'available'), false);
});
test('successful empty feeds remain available instead of being reported as an outage', async () => {
  const result = await getAggregatedF1NewsResult({ fetchImpl: async () => new Response(empty) });
  assert.equal(result.availability, 'available'); assert.deepEqual(result.items, []);
  assert.equal(result.sources.filter((source) => source.state === 'available').length, 4);
});
test('partial RSS failure retains real healthy headlines and reports the failing publisher', async () => {
  const result = await getAggregatedF1NewsResult({ fetchImpl: async (url) => String(url) === F1_RSS_SOURCES[0]!.url ? new Response('', { status: 429 }) : new Response(story) });
  assert.equal(result.availability, 'partial'); assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.title, 'Formula 1 fixture report');
  assert.equal(result.sources.find((source) => source.source === F1_RSS_SOURCES[0]!.name)?.state, 'unavailable');
});
test('configured paid-source success can rescue all RSS failures without pretending the RSS recovered', async () => {
  process.env.GUARDIAN_API_KEY = 'synthetic-key';
  const result = await getAggregatedF1NewsResult({ fetchImpl: async (url) => new URL(String(url)).hostname === 'content.guardianapis.com' ? Response.json({ response: { status: 'ok', results: [] } }) : new Response('', { status: 503 }) });
  assert.equal(result.availability, 'partial'); assert.equal(result.items.length, 0);
  assert.equal(result.sources.find((source) => source.source === 'The Guardian')?.state, 'available');
  assert.equal(result.sources.filter((source) => source.state === 'unavailable').length, 4);
});
test('malformed paid payload is an unavailable source while valid RSS remains usable', async () => {
  process.env.GUARDIAN_API_KEY = 'synthetic-key';
  const result = await getAggregatedF1NewsResult({ fetchImpl: async (url) => new URL(String(url)).hostname === 'content.guardianapis.com' ? Response.json({ unexpected: 'invalid' }) : new Response(story) });
  assert.equal(result.availability, 'partial'); assert.equal(result.items.length, 1); assert.equal(result.sources.find((source) => source.source === 'The Guardian')?.state, 'unavailable');
  assert.equal(JSON.stringify(result.sources).includes('synthetic-key'), false);
});
test('all disabled providers perform no transport work and legacy array consumers keep their contract', async () => {
  const result = await getAggregatedF1NewsResult({ providers: { rss: false, guardian: false, gnews: false, newsdata: false, newsapi: false, currents: false }, fetchImpl: async () => { throw new Error('Disabled source was requested'); } });
  assert.equal(result.sources.every((source) => source.state === 'disabled'), true); assert.equal(result.availability, 'unavailable');
  assert.deepEqual(await getAggregatedF1News({ fetchImpl: unavailable }), []);
});
test('strict headline reader continues to reject total failure rather than successful empty output', async () => {
  await assert.rejects(getF1NewsFeed({ strict: true, fetchImpl: unavailable }), (error: unknown) => error instanceof ProviderError);
  assert.deepEqual(await getF1NewsFeed({ strict: true, fetchImpl: async () => new Response(empty) }), []);
});
test('HTTP200 malformed feed roots, missing/scalar channels and unsupported XML cannot masquerade as healthy emptiness', async () => {
  for (const xml of ['<not-a-feed><rss version="2.0"></rss></not-a-feed>', '<rss version="2.0"></rss>', '<rss version="2.0"><channel>Wrong channel shape</channel></rss>', '<rss><channel><item>Wrong item shape</item></channel></rss>', '<feed><entry>Wrong entry shape</entry></feed>', '<!DOCTYPE rss [<!ENTITY fixture "data">]><rss><channel><title>&fixture;</title></channel></rss>']) {
    const result = await getAggregatedF1NewsResult({ fetchImpl: async () => new Response(xml) });
    assert.equal(result.availability, 'unavailable', xml); assert.equal(result.sources.filter((source) => source.state === 'unavailable').length, 4);
    await assert.rejects(getF1NewsFeed({ strict: true, fetchImpl: async () => new Response(xml) }), (error: unknown) => error instanceof ProviderError);
  }
  assert.equal((await getAggregatedF1NewsResult({ fetchImpl: async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty supported feed</title></feed>') })).availability, 'available');
});
test('inert DTD examples inside CDATA/comments/instructions remain valid news, while active declarations are denied', async () => {
  const example = story.replace('Disposable provider fixture.', '<![CDATA[Example: <!DOCTYPE html><html>HTML document</html>]]>');
  for (const xml of [example, `<!-- Example <!DOCTYPE html> -->${story}`, `<?fixture Example <!DOCTYPE html> ?>${story}`]) {
    assert.equal(hasXmlDoctype(xml), false);
    const result = await getAggregatedF1NewsResult({ fetchImpl: async () => new Response(xml) });
    assert.equal(result.availability, 'available'); assert.equal(result.items.length, 1);
  }
  assert.equal(hasXmlDoctype('<!-- inert <!DOCTYPE html> --><!DOCTYPE rss><rss/>'), true);
  assert.equal(hasXmlDoctype('<![CDATA[inert <!DOCTYPE html>]]><!DOCTYPE rss><rss/>'), true);
});
