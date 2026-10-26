import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAITING_RESULTS_MS,
  POLL_INTERVAL_MS,
  ageLabel,
  isHotWeekend,
  livePhase,
  nextPhaseChangeAt,
  raceReadTtlSeconds,
  refreshPlan,
  sessionEndMs,
  weekendWatchTargets,
} from './data-freshness';

// Times of the real 2026 United States GP weekend (Jolpica, round 19 layout): a conventional weekend.
const Q = { kind: 'Q', startIso: '2026-10-24T21:00:00Z' };
const R = { kind: 'R', startIso: '2026-10-25T20:00:00Z' };
const FP3 = { kind: 'FP3', startIso: '2026-10-24T17:30:00Z' };
const at = (iso: string) => Date.parse(iso);

test('a qualifying session moves before -> under way -> awaiting results -> results in on the clock alone', () => {
  assert.equal(livePhase(Q, at('2026-10-24T20:59:59Z'), false), 'before');
  assert.equal(livePhase(Q, at('2026-10-24T21:00:00Z'), false), 'under-way');
  assert.equal(livePhase(Q, at('2026-10-24T21:59:59Z'), false), 'under-way');
  assert.equal(livePhase(Q, at('2026-10-24T22:00:00Z'), false), 'awaiting-results');
  assert.equal(livePhase(Q, at('2026-10-24T22:20:00Z'), true), 'results-in');
  // Never published within six hours: the page stops claiming results are imminent.
  assert.equal(livePhase(Q, at('2026-10-24T22:00:00Z') + AWAITING_RESULTS_MS, false), 'finished');
});

test('practice has no Jolpica classification: it finishes instead of awaiting results', () => {
  assert.equal(livePhase(FP3, at('2026-10-24T18:00:00Z'), false), 'under-way');
  assert.equal(livePhase(FP3, at('2026-10-24T18:30:00Z'), false), 'finished');
});

test('OpenF1 end times replace the regulation window; date-only starts are never treated as timed', () => {
  const overrun = { ...R, endIso: '2026-10-25T22:41:00Z' };
  assert.equal(sessionEndMs(overrun), at('2026-10-25T22:41:00Z'));
  assert.equal(livePhase(overrun, at('2026-10-25T22:30:00Z'), false), 'under-way');
  assert.equal(livePhase(R, at('2026-10-25T22:30:00Z'), false), 'awaiting-results');
  assert.equal(livePhase({ kind: 'R', startIso: '1988-04-03' }, at('2026-01-01T00:00:00Z'), false), 'before');
});

test('the refresh plan polls only while a session runs or a classification is due', () => {
  const sessions = [FP3, Q, R];
  assert.deepEqual(refreshPlan(sessions, new Set(), at('2026-10-24T12:00:00Z')).poll, false);
  assert.deepEqual(refreshPlan(sessions, new Set(), at('2026-10-24T17:45:00Z')).focus, { kind: 'FP3', phase: 'under-way' });
  assert.deepEqual(refreshPlan(sessions, new Set(), at('2026-10-24T22:05:00Z')).focus, { kind: 'Q', phase: 'awaiting-results' });
  // Qualifying published: quiet again until the race starts.
  const quiet = refreshPlan(sessions, new Set(['Q']), at('2026-10-24T22:30:00Z'));
  assert.equal(quiet.poll, false);
  assert.equal(quiet.nextChangeAt, at('2026-10-25T20:00:00Z'));
  assert.equal(refreshPlan(sessions, new Set(['Q', 'R']), at('2026-10-25T22:30:00Z')).poll, false);
  assert.ok(POLL_INTERVAL_MS >= 30_000, 'polling stays light');
});

test('next phase change is the nearest real boundary', () => {
  assert.equal(nextPhaseChangeAt([Q, R], at('2026-10-24T20:00:00Z')), at('2026-10-24T21:00:00Z'));
  assert.equal(nextPhaseChangeAt([Q, R], at('2026-10-24T21:30:00Z')), at('2026-10-24T22:00:00Z'));
  assert.equal(nextPhaseChangeAt([Q], at('2026-10-25T05:00:00Z')), null);
});

const race = { season: 2026, round: 19, raceStartIso: R.startIso, sessions: [{ kind: 'FP1', iso: '2026-10-23T17:30:00Z' }, { kind: 'Q', iso: Q.startIso }, { kind: 'R', iso: R.startIso }] };

test('provider reads are fast during the weekend and slow for history', () => {
  assert.equal(isHotWeekend(race, at('2026-10-23T16:00:00Z')), false);
  assert.equal(isHotWeekend(race, at('2026-10-23T16:31:00Z')), true);
  assert.equal(raceReadTtlSeconds(race, at('2026-10-25T23:00:00Z')), 60);
  assert.equal(raceReadTtlSeconds(race, at('2026-10-27T12:00:00Z')), 300);
  assert.equal(raceReadTtlSeconds(race, at('2026-11-20T12:00:00Z')), 3600);
  assert.equal(raceReadTtlSeconds({ season: 1988, raceStartIso: '1988-04-03', sessions: [] }, at('2026-10-27T12:00:00Z')), 86_400);
});

test('the server watch targets only ended classified sessions inside their window', () => {
  assert.deepEqual(weekendWatchTargets([race], at('2026-10-24T21:30:00Z')), []);
  assert.deepEqual(weekendWatchTargets([race], at('2026-10-24T22:10:00Z')).map((t) => t.kind), ['Q']);
  // Qualifying's six-hour window closed overnight; the race's 24-hour correction watch is open.
  assert.deepEqual(weekendWatchTargets([race], at('2026-10-25T22:10:00Z')).map((t) => t.kind), ['R']);
  assert.deepEqual(weekendWatchTargets([race], at('2026-10-26T12:00:00Z')).map((t) => t.kind), ['R']);
  // A sprint weekend: sprint and qualifying both inside their windows on Saturday evening.
  const sprint = { season: 2026, round: 6, raceStartIso: '2026-05-03T20:00:00Z', sessions: [{ kind: 'S', iso: '2026-05-02T16:00:00Z' }, { kind: 'Q', iso: '2026-05-02T20:00:00Z' }, { kind: 'R', iso: '2026-05-03T20:00:00Z' }] };
  assert.deepEqual(weekendWatchTargets([sprint], at('2026-05-02T21:30:00Z')).map((t) => t.kind), ['Q', 'S']);
  assert.deepEqual(weekendWatchTargets([race], at('2026-10-27T12:00:00Z')), []);
});

test('age labels state the real age of a timestamp', () => {
  const now = at('2026-10-25T12:00:00Z');
  assert.equal(ageLabel(now - 5_000, now), 'just now');
  assert.equal(ageLabel(now - 14 * 60_000, now), '14 min ago');
  assert.equal(ageLabel(now - 3 * 3_600_000, now), '3 hr ago');
  assert.equal(ageLabel(now + 60_000, now), 'just now');
});
