import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { request } from 'node:https';
import type { lookup } from 'node:dns/promises';
import { jolpica } from '../src/jolpica/client';
import { JolpicaRequestControl } from '../src/jolpica/request-control';
import { mapDriver, mapRace, mapResult, timeStringToMs } from '../src/jolpica/mappers';
import { searchYouTubeF1Videos, getVideoDetails, getChannelStats } from '../src/youtube/data-client';
import { getF1Videos } from '../src/youtube';
import { canEmbed, formatCompactCount, toEnrichedVideo } from '../src/youtube/mappers';
import { getNewsDataF1News } from '../src/newsdata/client';
import { getF1NewsFeed } from '../src/rss';
import { fetchArticleHtml, isAllowedArticleUrl, isPublicAddress } from '../src/rss/safe-html';
import { getAggregatedF1News } from '../src/aggregator';
import { getOpenF1AccessConfig, openf1 } from '../src/openf1';
import { getGNewsF1News } from '../src/gnews';
import { getNewsAPIF1News } from '../src/newsapi';
import { getGuardianF1News } from '../src/guardian';
import { getCurrentsF1News } from '../src/currents';
import { ProviderError, readLimitedText, requestJson } from '../src/transport';

const keyNames = ['YOUTUBE_API_KEY','GUARDIAN_API_KEY','NEWSAPI_KEY','NEWSDATA_API_KEY','CURRENTS_API_KEY','GNEWS_API_KEY','OPENF1_ACCESS_TOKEN','OPENF1_REALTIME_ENABLED'];
const previous = new Map(keyNames.map(key => [key, process.env[key]]));
before(() => { for (const key of keyNames) delete process.env[key]; });
after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const driver = (index: number) => ({ driverId: `driver_${index}`, givenName: 'Fixture', familyName: String(index), nationality: 'Fixture', dateOfBirth: '1990-01-01', url: 'https://example.test/wiki/driver' });
function envelope(offset: number, total: number, table: object) {
  return { MRData: { limit: '100', offset: String(offset), total: String(total), ...table } };
}
const options = (fetchImpl: typeof fetch) => ({ strict: true, fetchImpl });

test('Jolpica pages historical drivers using actual metadata and protects internal offsets', async () => {
  const calls: number[] = [];
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input));
    const offset = Number(url.searchParams.get('offset'));
    assert.equal(url.searchParams.get('limit'), '100');
    calls.push(offset);
    return json(envelope(offset, 150, { DriverTable: { Drivers: Array.from({ length: Math.min(100, 150 - offset) }, (_, index) => driver(offset + index)) } }));
  };
  const found = await jolpica.getDrivers(1950, { ...options(fetchImpl), offset: 500, limit: 1 });
  assert.equal(found.length, 150);
  assert.deepEqual(calls, [0, 100]);
});

test('Standings snapshots preserve official round through multiple pages', async () => {
  const fetchImpl: typeof fetch = async input => {
    const offset = Number(new URL(String(input)).searchParams.get('offset'));
    return json(envelope(offset, 110, { StandingsTable: { StandingsLists: [{ season: '1950', round: '7', DriverStandings: Array.from({ length: Math.min(100, 110 - offset) }, (_, index) => ({ Driver: driver(offset + index), Constructors: [], position: String(offset + index + 1), positionText: String(offset + index + 1), points: '1', wins: '0' })) }] } }));
  };
  const snapshot = await jolpica.getDriverStandingsSnapshot(1950, options(fetchImpl));
  assert.equal(snapshot.round, 7);
  assert.equal(snapshot.season, '1950');
  assert.equal(snapshot.standings.length, 110);
});

test('Lap pagination counts timings and merges a lap split across pages', async () => {
  const timings = Array.from({ length: 154 }, (_, index) => ({ lap: String(Math.floor(index / 22) + 1), timing: { driverId: `driver_${index % 22}`, position: String(index % 22 + 1), time: '1:30.000' } }));
  const offsets: number[] = [];
  const fetchImpl: typeof fetch = async input => {
    const offset = Number(new URL(String(input)).searchParams.get('offset'));
    offsets.push(offset);
    const grouped = new Map<string, Array<(typeof timings)[number]['timing']>>();
    for (const row of timings.slice(offset, offset + 100)) grouped.set(row.lap, [...(grouped.get(row.lap) ?? []), row.timing]);
    return json(envelope(offset, timings.length, { RaceTable: { Races: [{ season: '2024', round: '1', Laps: [...grouped].map(([number, Timings]) => ({ number, Timings })) }] } }));
  };
  const laps = await jolpica.getLaps(2024, 1, options(fetchImpl));
  assert.equal(laps.length, 7);
  assert.ok(laps.every(lap => lap.Timings.length === 22));
  assert.deepEqual(offsets, [0, 100]);
});

test('Season and constructor results merge a race split across pages', async () => {
  const leaf = Array.from({ length: 154 }, (_, index) => ({ round: String(Math.floor(index / 22) + 1), result: { Driver: driver(index % 22), Constructor: { constructorId: 'fixture', name: 'Fixture' }, position: String(index % 22 + 1), positionText: String(index % 22 + 1), points: '0', number: String(index % 22 + 1) } }));
  const fetchImpl: typeof fetch = async input => {
    const offset = Number(new URL(String(input)).searchParams.get('offset'));
    const grouped = new Map<string, Array<(typeof leaf)[number]['result']>>();
    for (const row of leaf.slice(offset, offset + 100)) grouped.set(row.round, [...(grouped.get(row.round) ?? []), row.result]);
    return json(envelope(offset, leaf.length, { RaceTable: { Races: [...grouped].map(([round, Results]) => ({ season: '2024', round, raceName: 'Fixture race', date: '2024-01-01', Circuit: { circuitId: 'fixture', circuitName: 'Fixture', Location: { lat: '1', long: '1', locality: 'Fixture', country: 'Fixture' } }, Results })) } }));
  };
  for (const races of [await jolpica.getSeasonResults(2024, options(fetchImpl)), await jolpica.getConstructorResultsInSeason('fixture', 2024, options(fetchImpl))]) {
    assert.equal(races.length, 7);
    assert.equal(races.reduce((sum, race) => sum + race.Results.length, 0), 154);
  }
});

test('Failed later page never returns a successful partial collection', async () => {
  const fetchImpl: typeof fetch = async input => Number(new URL(String(input)).searchParams.get('offset')) === 0
    ? json(envelope(0, 150, { DriverTable: { Drivers: Array.from({ length: 100 }, (_, index) => driver(index)) } }))
    : json({}, 403);
  await assert.rejects(jolpica.getAllDrivers(options(fetchImpl)), /HTTP 403/);
  assert.deepEqual(await jolpica.getAllDrivers({ fetchImpl }), []);
});

test('Malformed metadata and traversal fail before corrupting the caller', async () => {
  await assert.rejects(jolpica.getSchedule(2024, options(async () => json({ MRData: {} }))), /invalid-response/);
  await assert.rejects(jolpica.getSchedule(2024, options(async () => json(envelope(0, 1, { RaceTable: { Races: [] } })))), /incomplete/);
  let calls = 0;
  await assert.rejects(jolpica.getDriver('../2024', options(async () => { calls++; return json({}); })), /invalid-input/);
  assert.equal(calls, 0);
});

test('Jolpica process controller coalesces reads, isolates mutable callers and bounds real starts', async () => {
  let now = 0;
  const starts: number[] = [];
  const control = new JolpicaRequestControl({ now: () => now, sleep: async ms => { now += ms; }, maxStartsPerHour: 5 });
  const operation = async () => { starts.push(now); await new Promise(resolve => setTimeout(resolve, 1)); return { rows: ['fixture'] }; };
  const [a, b] = await Promise.all([control.readThrough('shared', 60, {}, operation), control.readThrough('shared', 60, {}, operation)]);
  assert.equal(starts.length, 1);
  a.rows.push('caller mutation');
  assert.deepEqual(b.rows, ['fixture']);
  assert.deepEqual((await control.readThrough('shared', 60, {}, operation)).rows, ['fixture']);
  await Promise.all(['a','b','c','d'].map(key => control.readThrough(key, 0, {}, operation)));
  assert.deepEqual(starts, [0,260,520,780,1040]);
  await assert.rejects(control.readThrough('over-quota', 0, {}, operation), /rate-limit/);
  assert.equal(starts.length, 5);
  now += 3_600_000;
  await control.readThrough('recovered', 0, {}, operation);
  assert.equal(starts.length, 6);
});

test('Jolpica quota responses are not retried and remain distinguishable from empty data', async () => {
  let calls = 0;
  await assert.rejects(jolpica.getAllDrivers({ strict: true, fetchImpl: async () => { calls++; return json({}, 429); } }), /HTTP 429/);
  assert.equal(calls, 1);
});

test('Actual Jolpica client shares validated production transport reads between callers', async context => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => { calls++; return json(envelope(0, 1, { DriverTable: { Drivers: [driver(7)] } })); });
  const [a, b] = await Promise.all([jolpica.getDrivers(1977, { strict: true }), jolpica.getDrivers(1977, { strict: true })]);
  assert.equal(calls, 1);
  a[0]!.givenName = 'Mutation';
  assert.equal(b[0]?.givenName, 'Fixture');
  assert.equal((await jolpica.getDrivers(1977, { strict: true }))[0]?.givenName, 'Fixture');
  assert.equal(calls, 1);
});

test('Historical optional result fields stay unknown and malformed times stay absent', () => {
  const mapped = mapResult({ Driver: driver(1), number: '1', position: '1', positionText: '1', points: '1' });
  assert.equal(mapped.constructor, null);
  assert.equal(mapped.grid, null);
  assert.equal(mapped.laps, null);
  assert.equal(mapped.status, 'Unknown');
  assert.equal(timeStringToMs('1:90.000'), null);
  assert.equal(timeStringToMs('1:2:3:4'), null);
  assert.equal(timeStringToMs('-1'), null);
});

test('Date-only race sessions preserve unknown start times and optional driver biography fields', () => {
  const race = mapRace({ season: '1950', round: '1', raceName: 'Fixture', date: '1950-05-13', url: '', Circuit: { circuitId: 'fixture', circuitName: 'Fixture', url: '', Location: { lat: '1', long: '2', locality: 'Fixture', country: 'Fixture' } }, Qualifying: { date: '1950-05-12' } });
  assert.equal(race.raceStartIso, '1950-05-13');
  assert.equal(race.sessions[0]?.iso, '1950-05-12');
  const biography = mapDriver({ driverId: 'fixture', givenName: 'Fixture', familyName: 'Driver' });
  assert.equal(biography.nationality, 'Unknown');
  assert.equal(biography.dob, '');
});

test('Transport bounds stalled requests even if fetch ignores the signal and caps body bytes', async () => {
  await assert.rejects(requestJson('fixture', 'https://example.test', {}, { fetchImpl: () => new Promise(() => {}), timeoutMs: 15 }), /timeout/);
  await assert.rejects(readLimitedText(new Response('x'.repeat(20)), 10), ProviderError);
});

test('Strict YouTube exposes quota errors while render mode stays fail-soft', async () => {
  process.env.YOUTUBE_API_KEY = 'synthetic-test-key';
  const fetchImpl: typeof fetch = async () => json({}, 403);
  await assert.rejects(searchYouTubeF1Videos({ strict: true, fetchImpl }), /HTTP 403/);
  assert.deepEqual(await searchYouTubeF1Videos({ fetchImpl }), []);
  await assert.rejects(getVideoDetails(['abcdefghijk'], { strict: true, fetchImpl }), /HTTP 403/);
  await assert.rejects(getChannelStats(['UCabcdefghijklmnopqrstuv'], { strict: true, fetchImpl }), /HTTP 403/);
  await assert.rejects(getF1Videos({ strict: true, fetchImpl }), /HTTP 403/);
  assert.deepEqual(await searchYouTubeF1Videos({ strict: true, fetchImpl: async () => json({ items: [] }) }), []);
  delete process.env.YOUTUBE_API_KEY;
});

test('YouTube omitted and hidden counts stay unknown and regional restrictions apply to viewer country', async () => {
  process.env.YOUTUBE_API_KEY = 'synthetic-test-key';
  const fetchImpl: typeof fetch = async input => new URL(String(input)).pathname.endsWith('/channels')
    ? json({ items: [{ id: 'fixture_channel', snippet: { title: 'Fixture' }, statistics: { subscriberCount: '100', hiddenSubscriberCount: true } }] })
    : json({ items: [{ id: 'fixture_video', snippet: { title: 'Fixture', description: '', channelId: 'fixture_channel', channelTitle: 'Fixture', publishedAt: '2026-09-30T00:00:00Z' }, statistics: { viewCount: '0' }, status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT1M', regionRestriction: { blocked: ['DE'] } } }] });
  const [detail] = await getVideoDetails(['fixture_video'], { strict: true, fetchImpl });
  const [channel] = await getChannelStats(['fixture_channel'], { strict: true, fetchImpl });
  assert.ok(detail && channel);
  assert.equal(detail.viewCount, 0);
  assert.equal(detail.likeCount, null);
  assert.equal(detail.commentCount, null);
  assert.equal(channel.subscriberCount, null);
  const enriched = toEnrichedVideo(detail, new Map([[channel.channelId, channel]]));
  assert.equal(canEmbed(enriched), true);
  assert.equal(canEmbed(enriched, 'IN'), true);
  assert.equal(canEmbed(enriched, 'de'), false);
  assert.equal(formatCompactCount(null), 'Unknown');
  assert.equal(formatCompactCount(0), '0');
  delete process.env.YOUTUBE_API_KEY;
});

test('YouTube bounds batch concurrency, rejects oversized input and fails malformed items', async () => {
  process.env.YOUTUBE_API_KEY = 'synthetic-test-key';
  let active = 0;
  let maximum = 0;
  const fetchImpl: typeof fetch = async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 3)); active--; return json({ items: [] }); };
  assert.deepEqual(await getVideoDetails(Array.from({ length: 250 }, (_, index) => `fixture_${index}`), { strict: true, fetchImpl }), []);
  assert.equal(maximum, 3);
  await assert.rejects(getVideoDetails(Array.from({ length: 501 }, (_, index) => `fixture_${index}`), { strict: true, fetchImpl }), /invalid-input/);
  await assert.rejects(getVideoDetails(['fixture'], { strict: true, fetchImpl: async () => json({ items: [{ id: 'fixture', snippet: null }] }) }), /invalid-response/);
  delete process.env.YOUTUBE_API_KEY;
});

test('NewsData strict malformed envelopes reject; free request size is bounded', async () => {
  await assert.rejects(getNewsDataF1News({ strict: true, apiKey: 'synthetic', fetchImpl: async () => json({ status: 'success', results: null }) }), /invalid-response/);
  const rows = await getNewsDataF1News({ strict: true, apiKey: 'synthetic', pageSize: 50, revalidate: 0, fetchImpl: async (input, init) => {
    assert.equal(new URL(String(input)).searchParams.get('size'), '10');
    assert.equal((init as RequestInit & { next: { revalidate: number } }).next.revalidate, 600);
    assert.ok(init?.signal);
    return json({ status: 'success', results: [] });
  } });
  assert.deepEqual(rows, []);
  await assert.rejects(getNewsDataF1News({ strict: true, apiKey: 'synthetic', languages: ['en','it','es','de','fr','pt'], fetchImpl: async () => { throw new Error('should not fetch'); } }), /invalid-input/);
});

test('Strict credentialed news rejects malformed success records instead of reporting healthy emptiness', async () => {
  for (const key of ['GUARDIAN_API_KEY','NEWSAPI_KEY','CURRENTS_API_KEY','GNEWS_API_KEY']) process.env[key] = 'synthetic';
  await assert.rejects(getGNewsF1News({ strict: true, fetchImpl: async () => json({ articles: [null] }) }), /invalid-response/);
  await assert.rejects(getGuardianF1News({ strict: true, fetchImpl: async () => json({ response: { status: 'ok', results: [{}] } }) }), /invalid-response/);
  await assert.rejects(getCurrentsF1News({ strict: true, fetchImpl: async () => json({ status: 'ok', news: [{}] }) }), /invalid-response/);
  await assert.rejects(getNewsAPIF1News({ strict: true, fetchImpl: async () => json({ status: 'ok', articles: [{}] }) }), /invalid-response/);
  for (const key of ['GUARDIAN_API_KEY','NEWSAPI_KEY','CURRENTS_API_KEY','GNEWS_API_KEY']) delete process.env[key];
});

test('Strict RSS distinguishes a successful empty feed from total upstream failure', async () => {
  const empty = '<rss version="2.0"><channel><title>Fixture</title></channel></rss>';
  assert.deepEqual(await getF1NewsFeed({ strict: true, fetchImpl: async () => new Response(empty) }), []);
  await assert.rejects(getF1NewsFeed({ strict: true, fetchImpl: async () => new Response('failed', { status: 403 }) }), /news-feed: network/);
  await assert.rejects(getF1NewsFeed({ strict: true, fetchImpl: async () => new Response('malformed') }), /news-feed: network/);
});

test('Rendered RSS never fetches article metadata implicitly', async () => {
  const requested: string[] = [];
  const item = `<rss version="2.0"><channel><item><title>Formula 1 fixture</title><link>http://127.0.0.1/private</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
  const feed = await getF1NewsFeed({ fetchImpl: async input => { requested.push(String(input)); return new Response(item); } });
  assert.ok(feed.length > 0);
  assert.equal(requested.length, 4);
  assert.ok(requested.every(url => !url.includes('127.0.0.1')));
});

test('Atom entries select the alternate public article among multiple links', async () => {
  const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Formula 1 fixture</title><link rel="self" href="https://example.test/api/entry"/><link rel="alternate" href="https://example.test/article?id=1"/><published>2026-09-30T00:00:00Z</published></entry></feed>';
  const items = await getF1NewsFeed({ strict: true, fetchImpl: async () => new Response(atom) });
  assert.equal(items[0]?.link, 'https://example.test/article?id=1');
});

test('RSS-only outer selection cannot leak disabled credentialed providers', async context => {
  for (const key of ['GUARDIAN_API_KEY','NEWSAPI_KEY','NEWSDATA_API_KEY','CURRENTS_API_KEY','GNEWS_API_KEY']) process.env[key] = 'synthetic';
  const hosts: string[] = [];
  context.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => { hosts.push(new URL(String(input)).hostname); return new Response('<rss version="2.0"><channel /></rss>'); });
  await getAggregatedF1News({ providers: { rss: true, guardian: false, newsapi: false, newsdata: false, currents: false, gnews: false } });
  assert.equal(hosts.length, 4);
  assert.ok(hosts.every(host => ['www.motorsport.com','www.autosport.com','www.racefans.net','www.the-race.com'].includes(host)));
  for (const key of ['GUARDIAN_API_KEY','NEWSAPI_KEY','NEWSDATA_API_KEY','CURRENTS_API_KEY','GNEWS_API_KEY']) delete process.env[key];
});

test('Unicode headlines and meaningful query article IDs remain distinct', async context => {
  process.env.GNEWS_API_KEY = 'synthetic';
  context.mock.method(globalThis, 'fetch', async () => json({ totalArticles: 3, articles: ['優勝記録','予選結果','決勝速報'].map((title, index) => ({ title, url: `https://www.formula1.com/ja/latest/article?id=${index}`, description: 'Fixture', content: null, image: null, publishedAt: new Date().toISOString(), source: { name: 'Fixture', url: 'https://www.formula1.com' } })) }));
  // formula1.com is on the news-policy allowlist, so only dedupe can drop these rows.
  const items = await getAggregatedF1News({ providers: { rss: false, guardian: false, newsapi: false, newsdata: false, currents: false, gnews: true } });
  assert.equal(items.length, 3);
  delete process.env.GNEWS_API_KEY;
});

test('OG URLs, private addresses and IPv6 tunnels are denied without a network request', async () => {
  for (const url of ['http://127.0.0.1/a','https://127.0.0.1/a','https://motorsport.com.evil.test/a','https://user@www.motorsport.com/a','https://www.motorsport.com:444/a']) {
    assert.equal(isAllowedArticleUrl(url), false);
    await assert.rejects(fetchArticleHtml(url), /invalid-input/);
  }
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.16.0.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:192.168.1.1','2002:c0a8:0101::','2001:0000:4136:e378:8000:63bf:3fff:fdd2']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('OG metadata pins public DNS, rejects private resolutions, redirects and excessive bodies', async () => {
  let calls = 0;
  const publicLookup = (async () => [{ address: '8.8.8.8', family: 4 }]) as typeof lookup;
  const requestMock = (status: number, body: string) => ((url: URL, options: Record<string, unknown>, callback: (response: unknown) => void) => {
    calls++;
    assert.equal(url.hostname, 'www.motorsport.com');
    (options.lookup as (hostname: string, options: object, callback: (error: unknown, address: string, family: number) => void) => void)(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4); });
    const req = new EventEmitter() as EventEmitter & { end(): void };
    req.end = () => { const response = Object.assign(new PassThrough(), { statusCode: status, headers: { 'content-type': 'text/html' } }); callback(response); if (!response.destroyed) response.end(body); };
    return req;
  }) as unknown as typeof request;
  await assert.rejects(fetchArticleHtml('https://www.motorsport.com/a', 1000, { lookupImpl: (async () => [{ address: '127.0.0.1', family: 4 }]) as typeof lookup, requestImpl: requestMock(200, '') }), /invalid-input/);
  assert.equal(calls, 0);
  await assert.rejects(fetchArticleHtml('https://www.motorsport.com/a', 1000, { lookupImpl: publicLookup, requestImpl: requestMock(302, '<html/>') }), /invalid-response/);
  await assert.rejects(fetchArticleHtml('https://www.motorsport.com/a', 1000, { lookupImpl: publicLookup, requestImpl: requestMock(200, 'x'.repeat(1_000_001)) }), /invalid-response/);
  assert.equal(await fetchArticleHtml('https://www.motorsport.com/a', 1000, { lookupImpl: publicLookup, requestImpl: requestMock(200, '<html>Fixture</html>') }), '<html>Fixture</html>');
});

test('OpenF1 uses explicit Bearer config and UTC-safe incremental filters', async () => {
  process.env.OPENF1_ACCESS_TOKEN = 'synthetic-access-token';
  process.env.OPENF1_REALTIME_ENABLED = 'true';
  assert.deepEqual(getOpenF1AccessConfig(), { hasAccessToken: true, realtimeConfigured: true });
  await openf1.getIntervals(123, { strict: true, dateGte: '2026-09-30T18:00:00+05:30', fetchImpl: async (input, init) => {
    assert.equal(new URL(String(input)).searchParams.get('date>'), '2026-09-30T12:30:00');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-access-token');
    return json([{ session_key: 123, driver_number: 1, gap_to_leader: null, interval: null, date: '2026-09-30T12:30:01Z' }]);
  } });
  await assert.rejects(openf1.getLocation(123, { strict: true }), /invalid-input/);
  await assert.rejects(openf1.getIntervals(123, { strict: true, dateGte: '2026-09-30T00:00:00Z&session_key=1', fetchImpl: async () => json([]) }), /invalid-input/);
  await assert.rejects(openf1.getIntervals(123, { strict: true, fetchImpl: async () => json([{}]) }), /invalid-response/);
  await assert.rejects(openf1.getPositions(123, { strict: true, fetchImpl: async () => json([{ session_key: 123, driver_number: 1, position: '1', date: '2026-09-30T12:30:01Z' }]) }), /invalid-response/);
  delete process.env.OPENF1_ACCESS_TOKEN;
  delete process.env.OPENF1_REALTIME_ENABLED;
});
