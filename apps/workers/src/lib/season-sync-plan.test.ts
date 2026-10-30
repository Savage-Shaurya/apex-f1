import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FetchOpts, JolpicaRace } from '@apex/api-client/jolpica';
import { ProviderError } from '@apex/api-client/jolpica';
import { currentSeasonOperations } from './current-season-sync';
import type { JobContext } from './job-control';
import { planSeasonSync, synchronizeActiveSeasons } from './season-sync-plan';

// Test fixtures only: shaped like Jolpica responses.
const race = (season: number, round: number, date: string): JolpicaRace => ({
  season: String(season), round: String(round), raceName: `Fixture ${round}`, date, time: '13:00:00Z', url: 'https://example.invalid/race',
  Circuit: { circuitId: `fixture_${round}`, circuitName: 'Fixture Circuit', url: 'https://example.invalid/circuit', Location: { lat: '1', long: '2', locality: 'Test', country: 'Test' } },
});
const season2026 = [race(2026, 1, '2026-03-08'), race(2026, 2, '2026-10-25'), race(2026, 3, '2026-12-06')];
const season2027 = [race(2027, 1, '2027-03-14'), race(2027, 2, '2027-04-04')];
const options = (): FetchOpts => ({ strict: true, revalidate: 0 });
const schedule = (calendars: Record<string, JolpicaRace[]>, calls: string[] = []) =>
  (async (season: number | 'current' = 'current') => { calls.push(String(season)); return calendars[String(season)] ?? []; }) as typeof currentSeasonOperations.schedule;

test('a failed optional previous-season read is a warning, not a failed nightly job', async () => {
  const calendars: Record<string, JolpicaRace[]> = { current: season2027, 2027: season2027 };
  const reader = (async (season: number | 'current' = 'current') => {
    if (season === 2026) throw new Error('network');
    return calendars[String(season)] ?? [];
  }) as typeof currentSeasonOperations.schedule;
  const plan = await planSeasonSync(Date.parse('2027-03-20T03:00:00Z'), options, reader);
  assert.deepEqual(plan.seasons, [2027]); assert.equal(plan.warnings.length, 1);
  const operations: typeof currentSeasonOperations = {
    ...currentSeasonOperations, schedule: reader,
    async begin(input) { return { ...input, generation: '1', observationId: '00000000-0000-0000-0000-000000000001' }; },
    async drivers(year) { return { season: String(year), round: null, standings: [] }; },
    async teams(year) { return { season: String(year), round: null, standings: [] }; },
    async calendar(_year, races) { return { racesPersisted: races.length, sessionsScheduled: 0, withdrawnRaces: 0, withdrawnSessions: 0 }; },
    async standings() { return { drivers: 0, teams: 0 }; },
    async races() { return []; },
    async classified() { return []; },
  };
  const report = await synchronizeActiveSeasons(fakeJob(), { now: Date.parse('2027-03-20T03:00:00Z'), operations, maximumRounds: 0 });
  assert.deepEqual(report.errors, []); assert.equal(report.ok, true); assert.equal(report.complete, false);
  assert.deepEqual(report.errors, []); assert.equal(report.warnings.length, 1);
});

test('the previous calendar is not read once its correction window is certainly closed', async () => {
  const calls: string[] = [];
  const midSeason = [race(2027, 1, '2027-03-14'), race(2027, 2, '2027-06-04'), race(2027, 3, '2027-11-28')];
  const plan = await planSeasonSync(Date.parse('2027-07-01T03:00:00Z'), options, schedule({ current: midSeason, 2026: season2026 }, calls));
  assert.deepEqual(calls, ['current']); assert.deepEqual(plan.seasons, [2027]); assert.deepEqual(plan.warnings, []);
  // Early in the season the window may still be open, so it is read.
  const early: string[] = [];
  await planSeasonSync(Date.parse('2027-03-20T03:00:00Z'), options, schedule({ current: midSeason, 2026: season2026 }, early));
  assert.deepEqual(early, ['current', '2026']);
});

test('cron year set on 2026-12-10: previous season inside its 30-day window first, then the published 2027', async () => {
  const plan = await planSeasonSync(Date.parse('2026-12-10T03:00:00Z'), options, schedule({ current: season2026, 2027: season2027 }));
  assert.deepEqual(plan.seasons, [2026, 2027]);
  assert.equal(plan.active, 2027); assert.equal(plan.currentAlias, 2026); assert.deepEqual(plan.finished, [2026]);
});

test('cron year set on 2026-12-10 without a 2027 calendar: the finished 2026 only, no empty-season failure', async () => {
  const plan = await planSeasonSync(Date.parse('2026-12-10T03:00:00Z'), options, schedule({ current: season2026 }));
  assert.deepEqual(plan.seasons, [2026]); assert.deepEqual(plan.warnings, []);
});

test('cron year set on 2027-01-15: the 30-day correction window for 2026 has closed', async () => {
  const published = await planSeasonSync(Date.parse('2027-01-15T03:00:00Z'), options, schedule({ current: season2026, 2027: season2027 }));
  assert.deepEqual(published.seasons, [2027]);
  // Jolpica `current` already points at an empty 2027: keep the latest season with a calendar instead of failing.
  const calls: string[] = [];
  const empty = await planSeasonSync(Date.parse('2027-01-15T03:00:00Z'), options, schedule({ current: [], 2026: season2026 }, calls));
  assert.deepEqual(empty.seasons, [2026]); assert.equal(empty.active, 2026); assert.equal(empty.currentAlias, null);
  assert.deepEqual(calls, ['current', '2026']);
});

test('cron year set on 2027-01-03 with current = 2027: previous season still inside its window', async () => {
  const plan = await planSeasonSync(Date.parse('2027-01-03T03:00:00Z'), options, schedule({ current: season2027, 2026: season2026 }));
  assert.deepEqual(plan.seasons, [2026, 2027]); assert.deepEqual(plan.finished, [2026]);
});

test('cron year set on 2027-03-20: the active 2027 season only', async () => {
  const plan = await planSeasonSync(Date.parse('2027-03-20T03:00:00Z'), options, schedule({ current: season2027, 2026: season2026 }));
  assert.deepEqual(plan.seasons, [2027]); assert.equal(plan.currentAlias, 2027); assert.deepEqual(plan.finished, []);
});

test('a failed current calendar read is a reported failure, never a guessed season', async () => {
  const job = fakeJob();
  const failing = (async () => { throw new Error('network'); }) as typeof currentSeasonOperations.schedule;
  const report = await synchronizeActiveSeasons(job, { now: Date.parse('2027-01-15T03:00:00Z'), schedule: failing, operations: { ...currentSeasonOperations, schedule: failing } });
  assert.equal(report.ok, false); assert.deepEqual(report.seasons, []); assert.equal(report.errors.length, 1);
});

test('active-season sync runs each planned season with hooks, sums counts and tags errors by season', async () => {
  const job = fakeJob();
  const synced: number[] = [];
  const hooks: string[] = [];
  const operations: typeof currentSeasonOperations = {
    ...currentSeasonOperations,
    schedule: schedule({ current: season2026, 2026: season2026, 2027: season2027 }),
    async begin(input) { return { ...input, generation: '1', observationId: '00000000-0000-0000-0000-000000000001' }; },
    async drivers(year) { return { season: String(year), round: year === 2026 ? 3 : null, standings: [] }; },
    async teams(year) { return { season: String(year), round: year === 2026 ? 3 : null, standings: [] }; },
    async calendar(year, races) { synced.push(year as number); return { racesPersisted: races.length, sessionsScheduled: 0, withdrawnRaces: 0, withdrawnSessions: 0 }; },
    async standings() { return { drivers: 0, teams: 0 }; },
    async races() { return []; },
    async results() { return undefined as never; },
    async qualifying() { return []; },
  };
  const report = await synchronizeActiveSeasons(job, {
    now: Date.parse('2026-12-10T03:00:00Z'), operations, maximumRounds: 0,
    beforeSeason: (season) => { hooks.push(`before:${season}`); },
    afterSeason: (season) => { hooks.push(`after:${season}`); },
  });
  assert.deepEqual(report.seasons, [2026, 2027]);
  assert.deepEqual(synced, [2026, 2027]);
  assert.deepEqual(hooks, ['before:2026', 'after:2026', 'before:2027', 'after:2027']);
  assert.equal(report.counts.schedule_rounds, season2026.length + season2027.length);
  assert.equal(report.bySeason['2026']?.schedule_rounds, 3);
  assert.equal(report.ok, true);
});

// Cron resilience (2026-10-31): the season catch-up tells a Jolpica outage apart from our own failures.
test('a season sync that failed only because Jolpica was unavailable says so; any other failure does not', async () => {
  const outage = (async () => { throw new ProviderError('jolpica', 'timeout'); }) as typeof currentSeasonOperations.schedule;
  let report = await synchronizeActiveSeasons(fakeJob(), { now: Date.parse('2027-01-15T03:00:00Z'), schedule: outage, operations: { ...currentSeasonOperations, schedule: outage } });
  assert.equal(report.ok, false); assert.equal(report.providerUnavailable, true);
  const bug = (async () => { throw new TypeError('bug'); }) as typeof currentSeasonOperations.schedule;
  report = await synchronizeActiveSeasons(fakeJob(), { now: Date.parse('2027-01-15T03:00:00Z'), schedule: bug, operations: { ...currentSeasonOperations, schedule: bug } });
  assert.equal(report.ok, false); assert.equal(report.providerUnavailable, false);
  const base: typeof currentSeasonOperations = {
    ...currentSeasonOperations,
    schedule: schedule({ current: season2027, 2027: season2027 }),
    async begin(input) { return { ...input, generation: '1', observationId: '00000000-0000-0000-0000-000000000001' }; },
    async drivers() { throw new ProviderError('jolpica', 'http', 503); },
    async teams() { throw new ProviderError('jolpica', 'http', 400, undefined, 'edge'); },
    async calendar(_year, races) { return { racesPersisted: races.length, sessionsScheduled: 0, withdrawnRaces: 0, withdrawnSessions: 0 }; },
    async races() { return []; }, async classified() { return []; },
  };
  report = await synchronizeActiveSeasons(fakeJob(), { now: Date.parse('2027-03-20T03:00:00Z'), operations: base, maximumRounds: 0 });
  assert.equal(report.ok, false); assert.equal(report.errors.length, 2); assert.equal(report.providerUnavailable, true);
  report = await synchronizeActiveSeasons(fakeJob(), { now: Date.parse('2027-03-20T03:00:00Z'), operations: { ...base, async calendar() { throw new Error('database write failed'); } }, maximumRounds: 0 });
  assert.equal(report.ok, false); assert.equal(report.providerUnavailable, false, 'a persistence failure is ours, not the provider\'s');
});

function fakeJob(): JobContext {
  const controller = new AbortController();
  return { signal: controller.signal, lease: { key: 'jolpica-nightly', token: 'test-token', expiresAt: new Date(Date.now() + 120_000).toISOString() }, expiresAt: Date.now() + 50_000, assertActive: () => controller.signal.throwIfAborted(), remainingMs: () => 50_000 };
}
