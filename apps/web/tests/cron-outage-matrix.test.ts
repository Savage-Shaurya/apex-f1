/**
 * Cron outage matrix (cron resilience, 2026-10-31).
 *
 * Every scheduled cron route x every upstream failure mode, end to end and
 * deterministic (no network): a fault-injecting fetch stands in for the
 * providers, the REAL route handler builds its report, and the REAL workflow
 * runner (scripts/invoke-cron.mjs) decides the exit code and annotation.
 *
 *   outage modes  -> route 503 { retryable:true, reason:"provider-unavailable" };
 *                    runner retries (3 attempts) then exit 0 + ::warning:: while the
 *                    last success is recent, exit 1 + ::error:: with none on record
 *   our-bug modes -> route 500; runner exit 1 + ::error:: after ONE attempt
 *   success modes -> route 200; runner exit 0
 *
 * Fixtures below are test data shaped like provider responses; they never reach a page.
 * scripts/cron-coverage.test.mjs fails if a cron route is missing from CRON_MATRIX_ROUTES.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { jolpicaRequestControl } from '../../../packages/api-client/src/jolpica/request-control';
import { YT_F1_CHANNELS } from '@apex/api-client/youtube';
import { F1_RSS_SOURCES } from '@apex/api-client/rss';
import { GET as weatherSync } from '../app/api/cron/weather-sync/route';
import { GET as weekendWatch } from '../app/api/cron/weekend-watch/route';
import { GET as rssSync } from '../app/api/cron/rss-sync/route';
import { runLeasedCron } from '../lib/leased-cron';
import { seasonCronTask } from '../lib/season-cron';
import { handleYouTubeSync } from '../lib/youtube-cron';
import { syncRecentYouTubeUploads, youtubeSyncReaders } from '../lib/youtube-sync';
import { nextCache } from '../lib/next-cache';
import { defaultCronStatusStore, forgetCronSuccessesInProcess } from '../lib/cron-outcome';
import { currentSeasonOperations } from '../../workers/src/lib/current-season-sync';
import type { LeaseStore } from '../../workers/src/lib/job-control';

type RunCron = (args: string[], env: Record<string, string>, options: Record<string, unknown>) => Promise<number>;
let runCronCommand: RunCron;

/** Every schedulable cron route this matrix covers (checked by scripts/cron-coverage.test.mjs). */
export const CRON_MATRIX_ROUTES = ['weather-sync', 'weekend-watch', 'rss-sync', 'youtube-sync', 'jolpica-nightly'] as const;

const SECRET = 'disposable-matrix-secret';
const SITE = 'https://apex.test';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const YEAR = new Date(NOW).getUTCFullYear();
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoTime = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)}Z`;

// ---------- provider fixtures (test data shaped like the real responses) ----------
const circuit = (id: string) => ({ circuitId: id, circuitName: 'Fixture Circuit', url: 'https://example.invalid/circuit', Location: { lat: '19.4', long: '-99.09', locality: 'Fixture', country: 'Fixture' } });
const races = [
  // Finished two months ago (classification re-read by the season sync).
  { season: String(YEAR), round: '1', raceName: 'Fixture One Grand Prix', url: 'https://example.invalid/1', date: isoDay(NOW - 60 * DAY), time: isoTime(NOW - 60 * DAY), Circuit: circuit('fixture_one') },
  // Race in three days (inside the forecast horizon), qualifying ended two hours ago (due for weekend-watch).
  { season: String(YEAR), round: '2', raceName: 'Fixture Two Grand Prix', url: 'https://example.invalid/2', date: isoDay(NOW + 3 * DAY), time: isoTime(NOW + 3 * DAY), Qualifying: { date: isoDay(NOW - 2 * HOUR), time: isoTime(NOW - 2 * HOUR) }, Circuit: circuit('fixture_two') },
];
const mrdata = (total: number, table: Record<string, unknown>) => ({ MRData: { xmlns: '', series: 'f1', url: 'https://api.jolpi.ca/ergast/f1/', limit: '100', offset: '0', total: String(total), ...table } });
const jolpicaHealthy = (url: URL): Response => {
  const path = url.pathname;
  if (/\/(?:current|\d{4})\.json$/.test(path)) {
    const season = path.match(/\/(\d{4})\.json$/)?.[1];
    const rows = !season || season === String(YEAR) ? races : [];
    return Response.json(mrdata(rows.length, { RaceTable: { season: season ?? String(YEAR), Races: rows } }));
  }
  const round = path.match(/\/(\d{4})\/(\d+)\/(?:qualifying|sprint|results)\.json$/);
  if (round) return Response.json(mrdata(0, { RaceTable: { season: round[1], round: round[2], Races: [] } }));
  return Response.json({ detail: 'Not found.' }, { status: 404 });
};
const openMeteoHealthy = (url: URL): Response => {
  const start = Date.parse(`${url.searchParams.get('start_date')}T00:00:00Z`);
  const end = Date.parse(`${url.searchParams.get('end_date')}T00:00:00Z`);
  const days: string[] = [];
  for (let at = start; at <= end; at += DAY) days.push(isoDay(at));
  return Response.json({ utc_offset_seconds: 0, hourly: { time: [] }, daily: { time: days, temperature_2m_max: days.map(() => 24), temperature_2m_min: days.map(() => 14), precipitation_sum: days.map(() => 0), wind_speed_10m_max: days.map(() => 10), weathercode: days.map(() => 1), precipitation_probability_max: days.map(() => 10) } });
};
const rssHealthy = (): Response => new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>Fixture</title></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } });
const youtubeHealthy = (url: URL): Response => {
  if (url.pathname.endsWith('/channels'))
    return Response.json({ items: YT_F1_CHANNELS.map((channel) => ({ id: channel.channelId, snippet: { title: channel.name, description: '', thumbnails: {} }, contentDetails: { relatedPlaylists: { uploads: `UU${channel.channelId.slice(2)}` } } })) });
  if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: [] });
  return Response.json({ items: [] });
};

// ---------- fault injection ----------
const OUTAGE_MODES = ['connect-timeout', 'connection-reset', 'dns-failure', 'edge-400-html', 'edge-403-html', '429-retry-after', '429', '500', '502', '503', '504'] as const;
const BUG_MODES = ['own-400-json', '401', '404-json', '404-html', 'empty-200', 'truncated-body', 'wrong-schema', 'partial-pages'] as const;
const SUCCESS_MODES = ['healthy', 'slow-then-success'] as const;
type Mode = (typeof OUTAGE_MODES)[number] | (typeof BUG_MODES)[number] | (typeof SUCCESS_MODES)[number] | 'response-timeout';

const networkError = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
async function fault(mode: Mode, provider: Target['provider'], signal: AbortSignal | null | undefined, healthy: () => Response): Promise<Response> {
  const html = (status: number) => new Response(`<html><head><title>${status}</title></head><body><center>cloudflare</center></body></html>`, { status, headers: { 'content-type': 'text/html' } });
  switch (mode) {
    case 'healthy': return healthy();
    case 'slow-then-success': await new Promise((resolve) => setTimeout(resolve, 1_200)); return healthy();
    case 'response-timeout':
      return new Promise((_, reject) => { if (signal?.aborted) reject(new DOMException('aborted', 'AbortError')); signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); });
    case 'connect-timeout': throw networkError('UND_ERR_CONNECT_TIMEOUT');
    case 'connection-reset': throw networkError('ECONNRESET');
    case 'dns-failure': throw networkError('ENOTFOUND');
    case 'edge-400-html': return html(400);
    case 'edge-403-html': return html(403);
    case '429-retry-after': return new Response('{"detail":"Request was throttled."}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '5' } });
    case '429': return new Response('', { status: 429 });
    case '500': case '502': case '503': case '504': return html(Number(mode));
    case 'own-400-json': return Response.json({ detail: 'Bad Request: Endpoint does not support final filter.' }, { status: 400 });
    case '401': return Response.json({ error: { code: 401, message: 'API key not valid.' } }, { status: 401 });
    case '404-json': return Response.json({ detail: 'Not found.' }, { status: 404 });
    case '404-html': return html(404);
    case 'empty-200': return new Response('', { status: 200, headers: { 'content-type': provider === 'rss' ? 'application/rss+xml' : 'application/json' } });
    case 'truncated-body': return new Response(provider === 'rss' ? '<?xml version="1.0"?><rss version="2.0"><channel><item><title>Cut' : '{"MRData":{"total":"2', { headers: { 'content-type': 'application/json' } });
    case 'wrong-schema': return Response.json({ hello: 'world' });
    case 'partial-pages': {
      // Jolpica-shaped page that declares more rows than it carries (pagination total mismatch).
      const page = await healthy().json() as { MRData: Record<string, unknown> };
      return Response.json({ MRData: { ...page.MRData, total: '7' } });
    }
  }
}

interface Target {
  name: string;
  route: (typeof CRON_MATRIX_ROUTES)[number];
  provider: 'jolpica' | 'openmeteo' | 'rss' | 'youtube';
  /** Which requests the fault applies to; every other request is healthy. */
  faulted(url: URL): boolean;
  invoke(request: Request): Promise<Response>;
  /** Modes that do not apply to this provider (e.g. pagination for RSS). */
  skip?: readonly Mode[];
  /** Expected route status for a bug mode (500 unless noted). */
  bugStatus?: number;
}

const fakeLease: LeaseStore = {
  claim: async ({ key }) => ({ key, token: 'matrix-lease', expiresAt: new Date(Date.now() + 120_000).toISOString() }),
  renew: async (lease) => lease, release: async () => true,
};
const seasonOperations: typeof currentSeasonOperations = {
  ...currentSeasonOperations,
  async begin(input) { return { ...input, generation: '1', observationId: '00000000-0000-0000-0000-000000000001' }; },
  async drivers(year) { return { season: String(year), round: null, standings: [] }; },
  async teams(year) { return { season: String(year), round: null, standings: [] }; },
  async calendar(_year, rows) { return { racesPersisted: rows.length, sessionsScheduled: 0, withdrawnRaces: 0, withdrawnSessions: 0 }; },
  async standings() { return { drivers: 0, teams: 0 }; },
  async races() { return []; },
  async classified() { return []; },
};
const isJolpica = (url: URL) => url.hostname === 'api.jolpi.ca';
const TARGETS: Target[] = [
  { name: 'weather-sync / Jolpica calendar', route: 'weather-sync', provider: 'jolpica', faulted: isJolpica, invoke: weatherSync },
  { name: 'weather-sync / Open-Meteo forecast', route: 'weather-sync', provider: 'openmeteo', faulted: (url) => url.hostname.endsWith('open-meteo.com'), invoke: weatherSync, skip: ['partial-pages', 'truncated-body'] },
  { name: 'weekend-watch / Jolpica calendar', route: 'weekend-watch', provider: 'jolpica', faulted: isJolpica, invoke: weekendWatch },
  { name: 'weekend-watch / Jolpica classification', route: 'weekend-watch', provider: 'jolpica', faulted: (url) => isJolpica(url) && /\/(?:qualifying|sprint|results)\.json$/.test(url.pathname), invoke: weekendWatch },
  { name: 'rss-sync / every RSS source', route: 'rss-sync', provider: 'rss', faulted: (url) => F1_RSS_SOURCES.some((source) => new URL(source.url).hostname === url.hostname), invoke: rssSync, skip: ['partial-pages'] },
  {
    name: 'youtube-sync / YouTube Data API', route: 'youtube-sync', provider: 'youtube', faulted: (url) => url.hostname === 'www.googleapis.com', skip: ['partial-pages', 'truncated-body'],
    invoke: (request) => runLeasedCron(request, 'youtube-sync', () => handleYouTubeSync(request, { refresh: () => {}, sync: () => syncRecentYouTubeUploads({ ...youtubeSyncReaders, persist: async (videos) => videos.length }) }), { store: fakeLease }),
  },
  {
    name: 'jolpica-nightly / Jolpica season', route: 'jolpica-nightly', provider: 'jolpica', faulted: isJolpica,
    invoke: (request) => runLeasedCron(request, 'jolpica-nightly', (job) => seasonCronTask(job, { operations: seasonOperations, invalidateSeason: async () => {}, revalidateTag: () => {}, revalidatePath: () => {} }), { store: fakeLease, partialOnBudget: true }),
  },
];

let mode: Mode = 'healthy';
let current: Target = TARGETS[0]!;
const providerCalls: string[] = [];
const originalFetch = globalThis.fetch;
const originalNextCache = { ...nextCache };
const originalEnv = { CRON_SECRET: process.env.CRON_SECRET, YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY, DATABASE_URL: process.env.DATABASE_URL };

before(async () => {
  ({ runCronCommand } = (await import('../../../scripts/invoke-cron.mjs' as string)) as { runCronCommand: RunCron });
  process.env.CRON_SECRET = SECRET;
  process.env.YOUTUBE_API_KEY = 'matrix-test-key';
  delete process.env.DATABASE_URL;
  nextCache.revalidateTag = () => {};
  nextCache.revalidatePath = () => {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    providerCalls.push(url.hostname);
    const healthy = () => (isJolpica(url) ? jolpicaHealthy(url) : url.hostname.endsWith('open-meteo.com') ? openMeteoHealthy(url) : url.hostname === 'www.googleapis.com' ? youtubeHealthy(url) : rssHealthy());
    if (!current.faulted(url)) return healthy();
    return fault(mode, current.provider, init?.signal, healthy);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch;
  Object.assign(nextCache, originalNextCache);
  for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});
beforeEach(() => { jolpicaRequestControl.reset(); forgetCronSuccessesInProcess(); providerCalls.length = 0; mode = 'healthy'; });
afterEach(() => { jolpicaRequestControl.reset(); });

const request = (route: string, secret = SECRET) => new Request(`${SITE}/api/cron/${route}`, { headers: { authorization: `Bearer ${secret}` } });
async function callRoute(target: Target) {
  const response = await target.invoke(request(target.route));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text, headers: response.headers };
}
/** Runs the real workflow runner; `respond` answers each attempt (replaying a persisting outage, or calling the route live). */
async function runInvoker(route: string, respond: (attempt: number) => Promise<Response>, onSleep: () => void = () => {}) {
  const output: string[] = [];
  const summary: string[] = [];
  const sleeps: number[] = [];
  let attempts = 0;
  const code = await runCronCommand([route], { APEX_SITE_URL: SITE, CRON_SECRET: SECRET }, {
    fetchImpl: async () => respond(++attempts),
    log: (line: string) => output.push(line), errorLog: (line: string) => output.push(line),
    appendSummary: (line: string) => summary.push(line),
    sleep: async (ms: number) => { sleeps.push(ms); onSleep(); },
  });
  return { code, attempts, sleeps, text: output.join('\n'), summary: summary.join('\n') };
}
const replay = (result: { status: number; text: string }) => async () => new Response(result.text, { status: result.status, headers: { 'content-type': 'application/json' } });
const rememberRecentSuccess = (route: string) => defaultCronStatusStore().write(route, Date.now() - 5 * HOUR);

/** One row per case, printed at the end: the asserted outcome table. */
const table: string[] = [];
after(() => {
  console.log(`\nCron outage matrix: ${table.length} cases\n| target | mode | route | runner (recent success) | runner (no success) |\n|---|---|---|---|---|\n${table.join('\n')}`);
});

for (const target of TARGETS) {
  for (const outage of OUTAGE_MODES) {
    if (target.skip?.includes(outage)) continue;
    test(`${target.name} × ${outage}: 503 provider-unavailable; runner warns green with a recent success, fails red with none`, async () => {
      current = target; mode = outage;
      await rememberRecentSuccess(target.route);
      const first = await callRoute(target);
      assert.equal(first.status, 503, first.text);
      assert.equal(first.headers.get('retry-after'), '120');
      assert.equal(first.body.ok, false);
      assert.equal(first.body.retryable, true);
      assert.equal(first.body.reason, 'provider-unavailable');
      assert.equal(first.body.route, target.route);
      assert.ok(Math.abs(Date.parse(String(first.body.lastSuccessAt)) - (Date.now() - 5 * HOUR)) < 60_000);
      assert.doesNotMatch(first.text, /matrix-test-key|disposable-matrix-secret|cloudflare|Throttled/i);
      const green = await runInvoker(target.route, replay(first));
      assert.equal(green.code, 0); assert.equal(green.attempts, 3); assert.deepEqual(green.sleeps, [30_000, 90_000]);
      assert.match(green.text, /::warning::.*provider unavailable/); assert.doesNotMatch(green.text, /::error::/);
      assert.match(green.summary, /provider unavailable/);
      forgetCronSuccessesInProcess();
      const second = await callRoute(target);
      assert.equal(second.status, 503, second.text);
      assert.equal(second.body.lastSuccessAt, null);
      const red = await runInvoker(target.route, replay(second));
      assert.equal(red.code, 1); assert.equal(red.attempts, 3);
      assert.match(red.text, /::error::.*no successful run on record/);
      table.push(`| ${target.name} | ${outage} | 503 provider-unavailable (${String(first.body.provider)}) | exit 0, ::warning:: after 3 attempts | exit 1, ::error:: after 3 attempts |`);
    });
  }
  test(`${target.name} × response-timeout (upstream accepts and never answers): 503 provider-unavailable, runner warns green`, async () => {
    current = target; mode = 'response-timeout';
    await rememberRecentSuccess(target.route);
    const result = await callRoute(target);
    assert.equal(result.status, 503, result.text);
    assert.equal(result.body.reason, 'provider-unavailable');
    const green = await runInvoker(target.route, replay(result));
    assert.equal(green.code, 0); assert.match(green.text, /::warning::/);
    table.push(`| ${target.name} | response-timeout | 503 provider-unavailable (${String(result.body.provider)}) | exit 0, ::warning:: after 3 attempts | (as connect-timeout) |`);
  });
  for (const bug of BUG_MODES) {
    if (target.skip?.includes(bug)) continue;
    test(`${target.name} × ${bug}: our bug / config / invalid data → route ${target.bugStatus ?? 500}, runner red at once`, async () => {
      current = target; mode = bug;
      await rememberRecentSuccess(target.route);
      const result = await callRoute(target);
      assert.equal(result.status, target.bugStatus ?? 500, result.text);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.retryable, undefined);
      assert.equal(result.body.reason, undefined);
      const red = await runInvoker(target.route, replay(result));
      assert.equal(red.code, 1); assert.equal(red.attempts, 1, 'never retried'); assert.deepEqual(red.sleeps, []);
      assert.match(red.text, /::error::Cron returned HTTP 500\./); assert.doesNotMatch(red.text, /::warning::/);
      table.push(`| ${target.name} | ${bug} | ${result.status} | exit 1, ::error:: after 1 attempt | exit 1, ::error:: after 1 attempt |`);
    });
  }
  for (const success of SUCCESS_MODES) {
    test(`${target.name} × ${success}: 200, runner green`, async () => {
      current = target; mode = success;
      const result = await callRoute(target);
      assert.equal(result.status, 200, result.text);
      assert.equal(result.body.ok, true);
      const green = await runInvoker(target.route, replay(result));
      assert.equal(green.code, 0); assert.equal(green.attempts, 1); assert.doesNotMatch(green.text, /::error::|::warning::/);
      table.push(`| ${target.name} | ${success} | 200 ok | exit 0 | exit 0 |`);
    });
  }
  for (const failures of [1, 2]) {
    test(`${target.name} × success after ${failures} retr${failures === 1 ? 'y' : 'ies'}: runner green, no warning`, async () => {
      current = target;
      const green = await runInvoker(target.route, async (attempt) => {
        mode = attempt <= failures ? '503' : 'healthy';
        return target.invoke(request(target.route));
      }, () => jolpicaRequestControl.reset() /* time passes between attempts: remembered failures expire */);
      assert.equal(green.code, 0, green.text); assert.equal(green.attempts, failures + 1);
      assert.deepEqual(green.sleeps, [30_000, 90_000].slice(0, failures));
      assert.doesNotMatch(green.text, /::error::|::warning::/);
      table.push(`| ${target.name} | 503 then healthy (${failures} retr${failures === 1 ? 'y' : 'ies'}) | 503 → 200 | exit 0 after ${failures + 1} attempts | — |`);
    });
  }
}

// ---------- infrastructure, auth and configuration ----------
test('missing or invalid CRON_SECRET: 401 from every route, runner red at once, no provider call', async () => {
  for (const target of TARGETS.filter((item, index, all) => all.findIndex((other) => other.route === item.route) === index)) {
    current = target;
    const response = await target.invoke(request(target.route, 'wrong-secret'));
    assert.equal(response.status, 401, target.route);
    const red = await runInvoker(target.route, async () => new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    assert.equal(red.code, 1); assert.equal(red.attempts, 1); assert.match(red.text, /::error::Cron returned HTTP 401/);
  }
  assert.deepEqual(providerCalls, []);
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try { assert.equal((await weatherSync(request('weather-sync'))).status, 401, 'an unset server secret fails closed'); }
  finally { process.env.CRON_SECRET = saved; }
  const noSecret = await runCronCommand(['weather-sync'], { APEX_SITE_URL: SITE }, { log: () => {}, errorLog: () => {}, appendSummary: () => {}, fetchImpl: async () => assert.fail('no request without a secret') });
  assert.equal(noSecret, 1);
  table.push('| every route | missing/invalid CRON_SECRET | 401 | exit 1, ::error:: after 1 attempt | exit 1 |');
});

test('missing configuration: no YOUTUBE_API_KEY is a hard 503 failure (not an outage), runner red at once', async () => {
  const { GET: youtubeSync } = await import('../app/api/cron/youtube-sync/route');
  const saved = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    const response = await youtubeSync(request('youtube-sync'));
    const text = await response.text();
    assert.equal(response.status, 503); assert.doesNotMatch(text, /provider-unavailable/);
    const red = await runInvoker('youtube-sync', async () => new Response(text, { status: 503, headers: { 'content-type': 'application/json' } }));
    assert.equal(red.code, 1); assert.equal(red.attempts, 1);
    table.push('| youtube-sync | YOUTUBE_API_KEY missing | 503 (no outage report) | exit 1 after 1 attempt | exit 1 |');
  } finally { process.env.YOUTUBE_API_KEY = saved; }
});

test('job database down: lease claim ECONNREFUSED/57P01 is provider-unavailable (database); auth failure 28P01 stays red', async () => {
  current = TARGETS.find((target) => target.route === 'jolpica-nightly')!;
  const down = (error: Error): LeaseStore => ({ ...fakeLease, claim: async () => { throw error; } });
  const task = (job: Parameters<typeof seasonCronTask>[0]) => seasonCronTask(job, { operations: seasonOperations, invalidateSeason: async () => {}, revalidateTag: () => {}, revalidatePath: () => {} });
  for (const error of [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }), Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }), new Error('Connection terminated unexpectedly')]) {
    await rememberRecentSuccess('jolpica-nightly');
    const response = await runLeasedCron(request('jolpica-nightly'), 'jolpica-nightly', task, { store: down(error) });
    const text = await response.text();
    const body = JSON.parse(text);
    assert.equal(response.status, 503); assert.equal(body.reason, 'provider-unavailable'); assert.equal(body.provider, 'database');
    assert.doesNotMatch(text, /127\.0\.0\.1|5432/);
    const green = await runInvoker('jolpica-nightly', async () => new Response(text, { status: 503, headers: { 'content-type': 'application/json' } }));
    assert.equal(green.code, 0); assert.match(green.text, /::warning::.*\(database\)/);
  }
  const auth = await runLeasedCron(request('jolpica-nightly'), 'jolpica-nightly', task, { store: down(Object.assign(new Error('password authentication failed'), { code: '28P01' })) });
  const authText = await auth.text();
  assert.equal(auth.status, 503); assert.doesNotMatch(authText, /provider-unavailable/);
  const red = await runInvoker('jolpica-nightly', async () => new Response(authText, { status: 503, headers: { 'content-type': 'application/json' } }));
  assert.equal(red.code, 1); assert.equal(red.attempts, 1);
  table.push('| jolpica-nightly | DB down (ECONNREFUSED, 57P01, terminated) | 503 provider-unavailable (database) | exit 0, ::warning:: | exit 1 |');
  table.push('| jolpica-nightly | DB auth failure (28P01) | 503 (no outage report) | exit 1 after 1 attempt | exit 1 |');
});

test('overlapping runs: a second run while the lease is held is a healthy skip with no provider work', async () => {
  current = TARGETS.find((target) => target.route === 'jolpica-nightly')!;
  let held = false;
  const lease: LeaseStore = { ...fakeLease, claim: async (input) => { if (held) return null; held = true; return fakeLease.claim(input); }, release: async () => { held = false; return true; } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = runLeasedCron(request('jolpica-nightly'), 'jolpica-nightly', async () => { await gate; return Response.json({ ok: true, route: 'jolpica-nightly' }); }, { store: lease });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await runLeasedCron(request('jolpica-nightly'), 'jolpica-nightly', async () => assert.fail('duplicate work'), { store: lease });
  const body = await second.json();
  assert.equal(second.status, 200); assert.match(body.skipped, /Another owner/);
  release();
  assert.equal((await first).status, 200);
  const green = await runInvoker('jolpica-nightly', async () => Response.json(body));
  assert.equal(green.code, 0); assert.doesNotMatch(green.text, /::warning::|::error::/);
  table.push('| jolpica-nightly | overlapping run (lease held) | 200 skipped | exit 0 | exit 0 |');
});
