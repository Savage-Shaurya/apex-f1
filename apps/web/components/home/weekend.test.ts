import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homePhase, homeSectionOrder, startedSession, ageLabel, cleanHeadline, latestFinishedSession, matchTimingSession, maxDriverPoints, nextSession, raceVerdict, resultBadge, sessionFinished, titleFight, topThreeCodes, utcLabel, weekendLadder, type CalendarRound } from './weekend';

// Test fixtures only: shaped like Jolpica data, never rendered.
const weekend = [
  { kind: 'R', iso: '2026-10-25T20:00:00Z' },
  { kind: 'FP1', iso: '2026-10-23T17:30:00Z' },
  { kind: 'Q', iso: '2026-10-24T21:00:00Z' },
  { kind: 'FP2', iso: '2026-10-23T21:00:00Z' },
  { kind: 'FP3', iso: '2026-10-24T17:30:00Z' },
];
const now = Date.parse('2026-10-25T12:20:00Z');

test('the next session is the first published start still ahead, in time order', () => {
  assert.equal(nextSession(weekend, now)?.kind, 'R');
  assert.equal(nextSession(weekend, Date.parse('2026-10-23T18:00:00Z'))?.kind, 'FP2');
  assert.equal(nextSession(weekend, Date.parse('2026-10-26T00:00:00Z')), null);
  assert.equal(nextSession([{ kind: 'R', iso: '2026-10-25' }], now), null, 'a date without a time is never a countdown target');
});

test('the ladder never claims a result the provider has not published', () => {
  const rows = weekendLadder(weekend, now, {});
  assert.deepEqual(rows.map((r) => r.kind), ['FP1', 'FP2', 'FP3', 'Q', 'R']);
  assert.deepEqual(rows.map((r) => r.status), ['started', 'started', 'started', 'started', 'next']);
  const withQ = weekendLadder(weekend, now, { Q: ['ANT', 'VER', 'HAD', 'RUS'] });
  assert.equal(withQ[3]!.status, 'classified');
  assert.deepEqual(withQ[3]!.podium, ['ANT', 'VER', 'HAD']);
  assert.equal(withQ[0]!.podium, null, 'practice has no classification');
});

test('title maths: a 102-point lead with six Grands Prix left can be sealed at the next round', () => {
  const races: CalendarRound[] = [18, 19, 20, 21, 22, 23].map((round) => ({ round, name: `Round ${round}`, sessions: [{ kind: 'R', iso: '2026-11-01T20:00:00Z' }] }));
  const fight = titleFight([{ name: 'Leader', points: 340 }, { name: 'Rival', points: 238 }, { name: 'Third', points: 229 }, { name: 'Out', points: 150 }], races, 17)!;
  assert.equal(fight.pointsLeft, 150);
  assert.equal(fight.gap, 102);
  assert.equal(fight.clinched, false);
  assert.equal(fight.contenders, 2, 'rival and third can still draw level; the leader is not counted');
  assert.deepEqual(fight.decider && { round: fight.decider.round.round, lead: fight.decider.leadNeeded }, { round: 18, lead: 125 });
});

test('title maths: sprints add eight points, a lead above what remains is clinched, ties are not', () => {
  const sprint: CalendarRound = { round: 22, name: 'Sprint round', sessions: [{ kind: 'S', iso: 'x' }, { kind: 'R', iso: 'y' }] };
  const final: CalendarRound = { round: 23, name: 'Final', sessions: [{ kind: 'R', iso: 'z' }] };
  assert.equal(maxDriverPoints(sprint), 33);
  assert.equal(titleFight([{ name: 'A', points: 100 }, { name: 'B', points: 41 }], [sprint, final], 21)!.clinched, true);
  const tie = titleFight([{ name: 'A', points: 100 }, { name: 'B', points: 42 }], [sprint, final], 21)!;
  assert.equal(tie.clinched, false, 'equal points go to countback, so it is not decided');
  assert.equal(tie.decider?.round.round, 22);
  assert.equal(tie.decider?.leadNeeded, 25, 'leaving the sprint round more than 25 ahead seals it');
  const long = [17, 18, 19, 20, 21, 22, 23].map((round) => ({ round, name: `R${round}`, sessions: [{ kind: 'R', iso: 'x' }] }));
  assert.equal(titleFight([{ name: 'A', points: 100 }, { name: 'B', points: 90 }], long, 16)!.decider, null, 'a 10-point lead with seven rounds left cannot be decided next time out');
  assert.equal(titleFight([{ name: 'A', points: 10 }], [final], 22), null);
});

test('labels: UTC session times, honest unpublished times, server-side ages, clean headlines', () => {
  assert.equal(utcLabel('2026-10-25T20:00:00Z'), 'Sun 25 Oct · 20:00 UTC');
  assert.equal(utcLabel('2026-10-25'), 'Sun 25 Oct · time to be confirmed');
  assert.equal(utcLabel('soon'), 'Time not published');
  assert.equal(ageLabel(now - 5 * 60_000, now), '5 min ago');
  assert.equal(ageLabel(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(ageLabel(0, now), null);
  assert.equal(cleanHeadline('Antonelli on pole | Formula 1', 'Formula 1'), 'Antonelli on pole');
  assert.equal(cleanHeadline('Antonelli takes pole - RaceFans', 'RaceFans'), 'Antonelli takes pole');
  assert.equal(cleanHeadline('No suffix here', 'Autosport'), 'No suffix here');
  assert.equal(cleanHeadline('“It does feel different” Antonelli admits | Formula 1', 'RaceFans'), '“It does feel different” Antonelli admits');
  assert.equal(cleanHeadline('Short | Long section name', 'X'), 'Short | Long section name', 'never leaves a stub');
});

test('final timing: calendar slots match OpenF1 sessions by start time, only finished sessions count', () => {
  const sessions = [
    { session_key: 11391, date_start: '2026-10-24T17:30:00+00:00', date_end: '2026-10-24T18:30:00+00:00' },
    { session_key: 11392, date_start: '2026-10-24T21:00:00+00:00', date_end: '2026-10-24T22:00:00+00:00' },
    { session_key: 11393, date_start: '2026-10-25T20:00:00+00:00', date_end: '2026-10-25T22:00:00+00:00' },
    { session_key: 99999, date_start: '2026-10-24T21:05:00+00:00', date_end: '2026-10-24T22:05:00+00:00', is_cancelled: true },
  ];
  assert.equal(matchTimingSession('2026-10-24T21:00:00Z', sessions)?.session_key, 11392);
  assert.equal(matchTimingSession('2026-10-24T21:15:00Z', sessions)?.session_key, 11392, 'a 15-minute schedule shift is still the same session');
  assert.equal(matchTimingSession('2026-10-24T23:00:00Z', sessions), null, 'nothing within 20 minutes');
  assert.equal(matchTimingSession('2026-10-24', sessions), null, 'no time of day, no match');
  assert.equal(sessionFinished(sessions[1]!, now), true);
  assert.equal(sessionFinished(sessions[2]!, now), false, 'the race has not finished');
  assert.equal(latestFinishedSession(sessions, now)?.session_key, 11392);
});

test('final timing: top three needs three positions and a roster entry for each', () => {
  const roster = [{ driver_number: 12, name_acronym: 'ANT' }, { driver_number: 3, name_acronym: 'VER' }, { driver_number: 6, name_acronym: 'HAD' }];
  const rows = [{ driver_number: 3, position: 2 }, { driver_number: 12, position: 1 }, { driver_number: 6, position: 3 }, { driver_number: 44, position: null }];
  assert.deepEqual(topThreeCodes(rows, roster), ['ANT', 'VER', 'HAD']);
  assert.equal(topThreeCodes(rows.slice(0, 2), roster), null, 'missing third place');
  assert.equal(topThreeCodes(rows, roster.slice(0, 2)), null, 'unknown driver code is never guessed');
  assert.equal(topThreeCodes([{ ...rows[1]!, dsq: true }, rows[0]!, rows[2]!], roster), null, 'a disqualified row is not first place');
});

test('one badge per result source: official results are Classified, every OpenF1 top three is Final timing', () => {
  assert.equal(resultBadge('jolpica'), 'Classified');
  assert.equal(resultBadge('openf1'), 'Final timing');
  assert.equal(resultBadge(null), 'Final timing');
});

test('the race verdict never claims a finish without a published top three', () => {
  assert.equal(raceVerdict(undefined), 'start-reached');
  assert.equal(raceVerdict({ status: 'started', source: null }), 'start-reached', 'start time passed, nothing published');
  assert.equal(raceVerdict({ status: 'next', source: null }), 'start-reached');
  assert.equal(raceVerdict({ status: 'classified', source: 'openf1' }), 'chequered');
  assert.equal(raceVerdict({ status: 'classified', source: 'jolpica' }), 'classified');
});

test('a re-timed session (2026 Miami: published 20:00Z, ran 17:00Z) still matches its OpenF1 session by name', () => {
  const sessions = [
    { session_key: 11279, session_name: 'Qualifying', date_start: '2026-05-02T20:00:00+00:00', date_end: '2026-05-02T21:00:00+00:00' },
    { session_key: 11280, session_name: 'Race', date_start: '2026-05-03T17:00:00+00:00', date_end: '2026-05-03T19:00:00+00:00' },
  ];
  assert.equal(matchTimingSession('2026-05-03T20:00:00Z', sessions, 'R')?.session_key, 11280);
  assert.equal(matchTimingSession('2026-05-03T20:00:00Z', sessions), null, 'without a kind, time alone decides');
  assert.equal(matchTimingSession('2026-05-03T20:00:00Z', sessions, 'S'), null, 'a different session name never matches');
  assert.equal(matchTimingSession('2026-05-02T20:05:00Z', sessions, 'Q')?.session_key, 11279);
  assert.equal(matchTimingSession('2026-05-02T20:05:00Z', sessions, 'R'), null, 'a near start with the wrong name is not the race');
});

test('home phase follows the published schedule: build-up, weekend, then the result leads for four days', () => {
  const next = { sessions: [{ kind: 'FP1', iso: '2026-11-06T14:30:00Z' }, { kind: 'R', iso: '2026-11-08T17:00:00Z' }] };
  const previous = { raceStartIso: '2026-10-25T20:00:00Z' };
  assert.equal(homePhase(next, previous, Date.parse('2026-10-26T12:00:00Z')), 'result-in', 'the Monday after the race');
  assert.equal(homePhase(next, previous, Date.parse('2026-11-02T12:00:00Z')), 'build-up');
  assert.equal(homePhase(next, previous, Date.parse('2026-11-06T15:00:00Z')), 'weekend', 'first session start passed');
  assert.equal(homePhase(null, null, Date.parse('2026-12-20T00:00:00Z')), 'build-up');
  assert.deepEqual(homeSectionOrder('result-in'), ['last-race', 'championship', 'news']);
  assert.deepEqual(homeSectionOrder('build-up'), ['news', 'last-race', 'championship']);
});

test('startedSession names a session only within three hours of its published start and before any result', () => {
  const now = Date.parse('2026-10-24T21:30:00Z');
  const rows = weekendLadder([
    { kind: 'FP1', iso: '2026-10-23T17:30:00Z' },
    { kind: 'Q', iso: '2026-10-24T21:00:00Z' },
    { kind: 'R', iso: '2026-10-25T20:00:00Z' },
  ], now, {});
  assert.equal(startedSession(rows, now)?.kind, 'Q');
  assert.equal(startedSession(weekendLadder([{ kind: 'Q', iso: '2026-10-24T21:00:00Z' }], now, { Q: ['ANT', 'RUS', 'VER'] }), now), null, 'a published result ends it');
  assert.equal(startedSession(rows, Date.parse('2026-10-25T02:00:00Z')), null, 'not after three hours');
});

test('home and /latest print the same age for the same story at the same moment (R3-TIME-4)', async () => {
  const { relativeAge } = await import('@/components/news/relative-age');
  const now = Date.parse('2026-10-26T03:54:48Z');
  // The audited case: a story 2 h 50 min old read "3 h ago" on home and "2 hr ago" on /latest.
  for (const minutes of [1, 12, 59, 61, 170, 179, 300]) {
    const ms = now - minutes * 60_000;
    assert.equal(ageLabel(ms, now), relativeAge(ms, now, 'UTC'), `${minutes} min`);
  }
  assert.equal(ageLabel(now - 170 * 60_000, now), '2 h ago');
});
