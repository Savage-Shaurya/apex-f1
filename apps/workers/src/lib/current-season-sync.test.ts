import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapRace, type JolpicaRace } from '@apex/api-client/jolpica';
import { currentSeasonOperations, selectClassificationRounds, synchronizeCurrentSeason } from './current-season-sync';
import { JobBudgetError, JobLeaseLostError, type JobContext } from './job-control';

const driver = { driverId: 'real_driver', givenName: 'Test', familyName: 'Driver' };
const team = { constructorId: 'real_team', name: 'Test Team' };
const race = (round = 1): JolpicaRace => ({ season: '2026', round: String(round), raceName: 'Fixture Grand Prix', date: '2026-01-04', time: '12:00:00Z', url: 'https://example.invalid/race', Circuit: { circuitId: 'fixture_circuit', circuitName: 'Fixture Circuit', url: 'https://example.invalid/circuit', Location: { lat: '1', long: '2', locality: 'Test', country: 'Test' } }, Qualifying: { date: '2026-01-03', time: '12:00:00Z' } });
const result = { number: '4', position: '1', positionText: '1', points: '25', Driver: driver, Constructor: team };
const qualifying = { number: '4', position: '1', Driver: driver, Constructor: team };
function job(remaining = 50_000): JobContext {
  const controller = new AbortController();
  return { signal: controller.signal, lease: { key: 'jolpica-nightly', token: 'test-token', expiresAt: new Date(Date.now() + 120_000).toISOString() }, expiresAt: Date.now() + remaining, assertActive: () => controller.signal.throwIfAborted(), remainingMs: () => remaining };
}
function fixture() {
  const calls: string[] = [];
  let pages = 0;
  const operations: typeof currentSeasonOperations = {
    ...currentSeasonOperations,
    async begin(input) { calls.push(`begin:${input.scope}`); return { ...input, generation: '1', observationId: '00000000-0000-0000-0000-000000000001' }; },
    async schedule(_year, options) { calls.push('schedule'); assert.equal(options?.revalidate, 0); assert.equal(options?.strict, true); assert.ok(options?.signal); return [race()]; },
    async drivers() { calls.push('drivers'); return { season: '2026', round: 1, standings: [{ position: '1', positionText: '1', points: '25', wins: '1', Driver: driver, Constructors: [team] }] }; },
    async teams() { calls.push('teams'); return { season: '2026', round: 1, standings: [{ position: '1', positionText: '1', points: '25', wins: '1', Constructor: team }] }; },
    async calendar(_year, races, observation) { calls.push('calendar-write'); assert.equal(observation.scope, 'calendar:2026'); return { racesPersisted: races.length, sessionsScheduled: 2, withdrawnRaces: 0, withdrawnSessions: 0 }; },
    async standings(_year, _drivers, _teams, _rounds, observation) { calls.push('standings-write'); assert.equal(observation?.scope, 'standings:2026'); return { drivers: 1, teams: 1 }; },
    async races() { return [{ season: 2026, round: 1 }]; },
    async results() { calls.push('results'); return { race: { ...race(), Results: [result] }, results: [result] }; },
    async qualifying() { calls.push('qualifying'); return [qualifying]; },
    async classification(input) { calls.push('classification-write'); assert.equal(input.observation.scope, 'classification:2026:1'); return { raceId: 'fixture-race', results: 1, qualifying: 1, sprintResults: null, pitStops: null, laps: null, removed: { results: [], qualifying: [], sprintResults: [], pitStops: [], laps: [] } }; },
    async grade(_year, _round, _results, _qualifying, options) { calls.push('grade-page'); assert.equal(options?.batchSize, 500); pages++; return { graded: pages === 1 ? 500 : 100, pending: pages === 1 ? 100 : 0, conflicted: 0, deferred: pages === 1 ? 100 : 0, nextCursor: pages === 1 ? '00000000-0000-0000-0000-000000000500' : null, complete: pages > 1 }; },
  };
  return { operations, calls };
}

test('current sync reserves each observation before reading and grades only accepted snapshots in bounded pages', async () => {
  const setup = fixture();
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(report.ok, true); assert.equal(report.complete, true);
  assert.ok(setup.calls.indexOf('begin:calendar:2026') < setup.calls.indexOf('schedule'));
  assert.ok(setup.calls.indexOf('begin:standings:2026') < setup.calls.indexOf('drivers'));
  assert.ok(setup.calls.indexOf('begin:classification:2026:1') < setup.calls.indexOf('results'));
  assert.ok(setup.calls.indexOf('classification-write') < setup.calls.indexOf('grade-page'));
  assert.equal(report.counts.predictions_graded, 600);
  assert.equal(report.counts.predictions_pending, 0);
});

test('failed calendar is not turned into empty persisted success; independent valid standings survive', async () => {
  const setup = fixture();
  setup.operations.schedule = async () => { throw new Error('network'); };
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(report.ok, false); assert.equal(report.complete, false);
  assert.equal(setup.calls.includes('calendar-write'), false);
  assert.equal(setup.calls.includes('classification-write'), false);
  assert.equal(setup.calls.includes('standings-write'), true);
});

test('insufficient time defers transactions and classification without claiming complete', async () => {
  const setup = fixture();
  const report = await synchronizeCurrentSeason(2026, job(6_000), setup.operations);
  assert.equal(report.ok, true); assert.equal(report.complete, false);
  assert.equal(report.counts.calendar_races_deferred, 1);
  assert.equal(report.counts.standings_deferred, 1);
  assert.equal(setup.calls.some((call) => call.endsWith('-write')), false);
});

test('wrong classification identity never writes or grades under the requested round', async () => {
  const setup = fixture();
  setup.operations.results = async () => ({ race: { ...race(2), Results: [result] }, results: [result] });
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(report.ok, false);
  assert.equal(setup.calls.includes('classification-write'), false);
  assert.equal(setup.calls.includes('grade-page'), false);
});

test('incomplete official grading with no cursor remains explicitly deferred', async () => {
  const setup = fixture();
  setup.operations.grade = async () => ({ graded: 0, pending: 600, conflicted: 0, deferred: 600, nextCursor: null, complete: false });
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(report.complete, false); assert.equal(report.counts.prediction_pages_deferred, 1);
  assert.equal(report.counts.predictions_pending, 600);
});

test('classification synchronization includes past rounds even when no one made a prediction', async () => {
  const setup = fixture();
  setup.operations.races = async () => [];
  await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(setup.calls.includes('classification-write'), true);
});

test('cancelled jobs stop before allocating source observations', async () => {
  const setup = fixture();
  const context = job();
  context.assertActive = () => { throw new Error('shutdown'); };
  await assert.rejects(synchronizeCurrentSeason(2026, context, setup.operations), /shutdown/);
  assert.deepEqual(setup.calls, []);
});

test('round rotation is bounded and preserves latest priority without guessing completion from a recent start', () => {
  const races = Array.from({ length: 10 }, (_, index) => mapRace(race(index + 1)));
  const selected = selectClassificationRounds(races, races.map((entry) => entry.round), 4);
  assert.equal(selected.length, 4); assert.deepEqual(selected.slice(0, 2), [10, 9]);
  const justStarted = { ...races[0]!, raceStartIso: new Date(Date.now() - 3_600_000).toISOString() };
  assert.deepEqual(selectClassificationRounds([justStarted], [1]), []);
});

test('missing classifications are filled first, after the two latest rounds, and stored rounds rotate at most two', () => {
  const races = Array.from({ length: 23 }, (_, index) => mapRace(race(index + 1)));
  const rounds = races.map((entry) => entry.round);
  // Fresh database: only rounds 1-5 are stored.
  const fresh = selectClassificationRounds(races, rounds, 24, Date.now(), new Set([1, 2, 3, 4, 5]));
  assert.deepEqual(fresh.slice(0, 2), [23, 22]);
  assert.deepEqual(fresh.slice(2, 18), [21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6]);
  assert.equal(fresh.length, 20); // + two rotated stored rounds
  assert.ok(fresh.slice(18).every((round) => round >= 1 && round <= 5));
  // Complete season: the latest two plus a rotation of two, not all 23 again.
  const complete = selectClassificationRounds(races, rounds, 24, Date.now(), new Set(rounds));
  assert.equal(complete.length, 4); assert.deepEqual(complete.slice(0, 2), [23, 22]);
  // A small maximum still keeps the latest-first priority, then missing rounds.
  assert.deepEqual(selectClassificationRounds(races, rounds, 4, Date.now(), new Set([1, 2, 3, 4, 5])), [23, 22, 21, 20]);
});

test('stored classification progress steers the round choice and is reported', async () => {
  const setup = fixture();
  setup.operations.classified = async () => [];
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations);
  assert.equal(report.counts.classifications_missing_before_run, 1);
  assert.equal(setup.calls.includes('classification-write'), true);
  const unread = fixture();
  unread.operations.classified = async () => { throw new Error('database down'); };
  const fallback = await synchronizeCurrentSeason(2026, job(), unread.operations);
  assert.equal(fallback.counts.classification_progress_unread, 1);
  assert.equal(unread.calls.includes('classification-write'), true);
});

test('running out of time mid-season keeps committed work and reports a partial, resumable run', async () => {
  const setup = fixture();
  const controller = new AbortController();
  let remaining = 50_000;
  const context: JobContext = {
    signal: controller.signal, lease: { key: 'jolpica-nightly', token: 'test-token', expiresAt: new Date(Date.now() + 120_000).toISOString() },
    expiresAt: Date.now() + remaining, remainingMs: () => remaining,
    assertActive: () => { controller.signal.throwIfAborted(); if (remaining <= 0) throw new JobBudgetError(); },
  };
  // The budget lapses while the classification write is in flight.
  setup.operations.classification = async () => { remaining = 0; controller.abort(new JobBudgetError()); throw new Error('aborted by budget'); };
  const report = await synchronizeCurrentSeason(2026, context, setup.operations);
  assert.equal(report.ok, true); assert.equal(report.complete, false);
  assert.equal(report.counts.budget_exhausted, 1);
  assert.equal(report.counts.drivers_persisted, 1, 'standings committed before the budget ran out are reported');
  assert.deepEqual(report.errors, [], 'a budget stop is not a provider or persistence error');
});

test('a lost lease is never turned into a partial report', async () => {
  const setup = fixture();
  const controller = new AbortController();
  const context = job();
  context.assertActive = () => controller.signal.throwIfAborted();
  Object.assign(context, { signal: controller.signal });
  setup.operations.classification = async () => { controller.abort(new JobLeaseLostError()); throw new Error('lease lost'); };
  await assert.rejects(synchronizeCurrentSeason(2026, context, setup.operations), JobLeaseLostError);
});

test('a complete stored season is complete even though only a rotation of rounds is re-read', async () => {
  const setup = fixture();
  const races = Array.from({ length: 6 }, (_, index) => race(index + 1));
  setup.operations.schedule = async () => races;
  setup.operations.races = async () => [];
  setup.operations.classified = async () => [1, 2, 3, 4, 5, 6];
  setup.operations.results = async (_year, round) => ({ race: { ...race(round), Results: [result] }, results: [result] });
  setup.operations.classification = async () => ({ raceId: 'fixture-race', results: 1, qualifying: 1, sprintResults: null, pitStops: null, laps: null, removed: { results: [], qualifying: [], sprintResults: [], pitStops: [], laps: [] } });
  setup.operations.grade = async () => ({ graded: 0, pending: 0, conflicted: 0, deferred: 0, nextCursor: null, complete: true });
  const report = await synchronizeCurrentSeason(2026, job(), setup.operations, 24);
  assert.equal(report.counts.classification_results, 4);
  assert.equal(report.counts.prediction_races_deferred, 0);
  assert.equal(report.complete, true);
  // A full operator run re-reads every stored round.
  const full = selectClassificationRounds(races.map(mapRace), [1, 2, 3, 4, 5, 6], 40, Date.now(), new Set([1, 2, 3, 4, 5, 6]));
  assert.equal(full.length, 6);
});
