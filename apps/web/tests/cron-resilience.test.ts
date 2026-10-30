import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { jolpica, type FetchOpts, type JolpicaRace } from '@apex/api-client/jolpica';
import { openmeteo } from '@apex/api-client/openmeteo';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { GET as weatherSync } from '../app/api/cron/weather-sync/route';
import { GET as weekendWatch } from '../app/api/cron/weekend-watch/route';
import { forgetCronSuccessesInProcess, finalizeCronResponse, PROVIDER_UNAVAILABLE, type CronStatusStore } from '../lib/cron-outcome';

// Cron resilience (2026-10-31, Mexico City weekend): Jolpica's origin was overloaded, the
// calendar read failed, and weather-sync / weekend-watch answered HTTP 500 every run.

const originals = { schedule: jolpica.getSchedule, qualifying: jolpica.getQualifyingFull, weather: openmeteo.getRaceWeather };
const originalSecret = process.env.CRON_SECRET;
const originalDatabase = process.env.DATABASE_URL;
beforeEach(() => { process.env.CRON_SECRET = 'disposable-test-secret'; delete process.env.DATABASE_URL; forgetCronSuccessesInProcess(); });
afterEach(() => {
  jolpica.getSchedule = originals.schedule; jolpica.getQualifyingFull = originals.qualifying; openmeteo.getRaceWeather = originals.weather;
  if (originalSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret;
  if (originalDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabase;
});
const request = (route: string) => new Request(`http://localhost/api/cron/${route}`, { headers: { authorization: 'Bearer disposable-test-secret' } });
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoTime = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)}Z`;
/** Test fixture shaped like a Jolpica race; never rendered. */
function fixtureRace(raceAt: number, qualifyingAt?: number): JolpicaRace {
  return {
    season: String(new Date(raceAt).getUTCFullYear()), round: '20', raceName: 'Fixture Grand Prix', url: 'https://example.invalid/race',
    date: isoDay(raceAt), time: isoTime(raceAt),
    ...(qualifyingAt ? { Qualifying: { date: isoDay(qualifyingAt), time: isoTime(qualifyingAt) } } : {}),
    Circuit: { circuitId: 'fixture', circuitName: 'Fixture Circuit', url: 'https://example.invalid/circuit', Location: { lat: '19.4', long: '-99.09', locality: 'Fixture', country: 'Fixture' } },
  } as JolpicaRace;
}
const DAY = 86_400_000;
type Schedule = typeof jolpica.getSchedule;
/** Jolpica unavailable, but the request controller holds a validated calendar from three days ago. */
const lastGoodCalendar = (races: JolpicaRace[], storedAt = Date.now() - 3 * DAY): Schedule => (async (season: number | 'current' = 'current', opts: FetchOpts = {}) => {
  assert.equal(season, 'current');
  assert.ok(opts.staleFallback && opts.staleFallback.maxAgeMs >= 3 * DAY, 'cron calendar reads accept an older validated copy');
  opts.staleFallback.onServed?.(storedAt);
  return races;
}) as Schedule;
const failingCalendar = (error: unknown): Schedule => (async () => { throw error; }) as Schedule;

test('weather-sync: an unavailable Jolpica falls back to the last validated calendar and still refreshes forecasts', async () => {
  const storedAt = Date.now() - 3 * DAY;
  jolpica.getSchedule = lastGoodCalendar([fixtureRace(Date.now() + 40 * DAY)], storedAt);
  const response = await weatherSync(request('weather-sync'));
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.ok, true);
  assert.equal(report.degraded, true);
  assert.deepEqual(report.results.calendar, { source: 'last-good', storedAt: new Date(storedAt).toISOString() });
});

test('weather-sync: no calendar at all during an outage is a retryable provider-unavailable report with lastSuccessAt', async () => {
  jolpica.getSchedule = (async () => [fixtureRace(Date.now() + 40 * DAY)]) as Schedule;
  assert.equal((await weatherSync(request('weather-sync'))).status, 200);
  for (const error of [new ProviderError('jolpica', 'timeout'), new ProviderError('jolpica', 'http', 429), new ProviderError('jolpica', 'http', 400, undefined, 'edge')]) {
    jolpica.getSchedule = failingCalendar(error);
    const response = await weatherSync(request('weather-sync'));
    const report = await response.json();
    assert.equal(response.status, 503, error.message);
    assert.equal(response.headers.get('retry-after'), '120');
    assert.equal(report.ok, false);
    assert.equal(report.retryable, true);
    assert.equal(report.reason, PROVIDER_UNAVAILABLE);
    assert.equal(report.provider, 'jolpica');
    assert.equal(report.route, 'weather-sync');
    assert.ok(Date.now() - Date.parse(report.lastSuccessAt) < 60_000, 'the previous run succeeded moments ago');
  }
});

test('weather-sync: our own bad request, invalid data or a bug stays a hard failure (never retryable)', async () => {
  for (const error of [new ProviderError('jolpica', 'http', 400, undefined, 'provider'), new ProviderError('jolpica', 'invalid-response'), new TypeError('bug')]) {
    jolpica.getSchedule = failingCalendar(error);
    const response = await weatherSync(request('weather-sync'));
    const report = await response.json();
    assert.equal(response.status, 500, String(error));
    assert.equal(report.ok, false);
    assert.equal(report.retryable, undefined);
    assert.equal(report.reason, undefined);
  }
});

test('weather-sync: Open-Meteo unavailable for every race is provider-unavailable; with no success on record lastSuccessAt is null', async () => {
  jolpica.getSchedule = (async () => [fixtureRace(Date.now() + 3 * DAY)]) as Schedule;
  openmeteo.getRaceWeather = (async () => { throw new ProviderError('openmeteo', 'timeout'); }) as typeof openmeteo.getRaceWeather;
  const response = await weatherSync(request('weather-sync'));
  const report = await response.json();
  assert.equal(response.status, 503);
  assert.equal(report.reason, PROVIDER_UNAVAILABLE);
  assert.equal(report.provider, 'openmeteo');
  assert.equal(report.lastSuccessAt, null);
});

test('weekend-watch: nothing due runs on the last validated calendar instead of failing', async () => {
  jolpica.getSchedule = lastGoodCalendar([fixtureRace(Date.now() + 10 * DAY)]);
  const response = await weekendWatch(request('weekend-watch'));
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.ok, true);
  assert.equal(report.degraded, true);
  assert.equal(report.results.calendar.source, 'last-good');
  assert.match(report.skipped, /nothing to check/);
});

test('weekend-watch: a due classification that cannot be read during an outage is deferred (503 retryable), a bad answer is not', async () => {
  const race = fixtureRace(Date.now() + DAY, Date.now() - 3 * 3_600_000);
  jolpica.getSchedule = lastGoodCalendar([race]);
  jolpica.getQualifyingFull = (async () => { throw new ProviderError('jolpica', 'timeout'); }) as typeof jolpica.getQualifyingFull;
  let response = await weekendWatch(request('weekend-watch'));
  let report = await response.json();
  assert.equal(response.status, 503);
  assert.equal(report.retryable, true);
  assert.equal(report.reason, PROVIDER_UNAVAILABLE);
  assert.equal(report.results.calendar.source, 'last-good');
  assert.equal(report.results.unavailable, 1);
  assert.equal(report.lastSuccessAt, null);
  jolpica.getQualifyingFull = (async () => { throw new ProviderError('jolpica', 'invalid-response'); }) as typeof jolpica.getQualifyingFull;
  response = await weekendWatch(request('weekend-watch'));
  report = await response.json();
  assert.equal(response.status, 500);
  assert.equal(report.retryable, undefined);
});

test('weekend-watch: an unreadable calendar with no copy is provider-unavailable only when Jolpica is down', async () => {
  jolpica.getSchedule = failingCalendar(new ProviderError('jolpica', 'timeout'));
  let response = await weekendWatch(request('weekend-watch'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, PROVIDER_UNAVAILABLE);
  jolpica.getSchedule = failingCalendar(new ProviderError('jolpica-admission', 'http', 401, undefined, 'provider'));
  response = await weekendWatch(request('weekend-watch'));
  assert.equal(response.status, 500);
});

test('finalizeCronResponse records only a successful report for its own route and stamps lastSuccessAt on outages', async () => {
  const written: Array<[string, number, string]> = [];
  let stored: number | null = Date.parse('2026-10-30T12:00:00Z');
  const store: CronStatusStore = { read: async () => stored, write: async (route, at, kind = 'success') => { written.push([route, at, kind]); } };
  await finalizeCronResponse('weather-sync', Response.json({ ok: false, route: 'weather-sync' }, { status: 500 }), store);
  await finalizeCronResponse('weather-sync', Response.json({ ok: true, route: 'rss-sync' }), store);
  assert.equal(written.length, 0);
  // Review F-02: a degraded run (last-good calendar, some sources down) is NOT a success for the
  // staleness alarm. It is recorded separately and carries the last FULL success for the runner.
  const degraded = await finalizeCronResponse('weather-sync', Response.json({ ok: true, route: 'weather-sync', degraded: true }), store);
  assert.equal(degraded.status, 200);
  assert.deepEqual(written.map(([, , kind]) => kind), ['degraded']);
  assert.equal((await degraded.json()).lastSuccessAt, '2026-10-30T12:00:00.000Z');
  const ok = await finalizeCronResponse('weather-sync', Response.json({ ok: true, route: 'weather-sync' }), store);
  assert.equal(ok.status, 200);
  assert.deepEqual(written.map(([, , kind]) => kind), ['degraded', 'success']);
  const outage = await finalizeCronResponse('weather-sync', Response.json({ ok: false, route: 'weather-sync', retryable: true, reason: PROVIDER_UNAVAILABLE }, { status: 503, headers: { 'retry-after': '120', 'cache-control': 'no-store' } }), store);
  assert.equal(outage.status, 503);
  assert.equal(outage.headers.get('retry-after'), '120');
  assert.equal((await outage.json()).lastSuccessAt, '2026-10-30T12:00:00.000Z');
  stored = null;
  const unknown = await finalizeCronResponse('weather-sync', Response.json({ ok: false, route: 'weather-sync', retryable: true, reason: PROVIDER_UNAVAILABLE }, { status: 503 }), { ...store, read: async () => { throw new Error('redis down'); } });
  assert.equal((await unknown.json()).lastSuccessAt, null);
});

test('review F-02: runs on a last-good calendar never refresh lastSuccessAt, so the stale alarm keeps counting', async () => {
  jolpica.getSchedule = failingCalendar(new ProviderError('jolpica', 'timeout'));
  // Days of degraded runs on the last-good calendar...
  jolpica.getSchedule = lastGoodCalendar([fixtureRace(Date.now() + 40 * DAY)]);
  for (let run = 0; run < 3; run++) {
    const response = await weatherSync(request('weather-sync'));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.degraded, true);
    assert.equal(body.lastSuccessAt, null, 'no full success on record: the runner must go red, not warn');
  }
  // ...then the copy is gone: the outage report still has no full success on record.
  jolpica.getSchedule = failingCalendar(new ProviderError('jolpica', 'timeout'));
  const outage = await (await weatherSync(request('weather-sync'))).json();
  assert.equal(outage.lastSuccessAt, null);
  assert.ok(Date.now() - Date.parse(outage.lastDegradedAt) < 60_000, 'the degraded runs are recorded separately');
});
