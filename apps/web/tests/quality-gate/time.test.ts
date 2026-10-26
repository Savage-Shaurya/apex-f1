/**
 * Quality gate, time: fake-clock tests of the real phase and season rules.
 *
 * Every case is run with the process time zone set to five different zones
 * (Node re-reads TZ when it changes), because audits found server- and
 * viewer-zone leaks (R3-TIME-3, R3-TIME-5, D2-TIME-DST). The rules take
 * `now` in milliseconds, so the answers must be identical in every zone.
 *
 * Fixture calendar: the real 2026 United States GP (R18, Austin), Mexico City
 * GP (R19) and Abu Dhabi GP (R23) times as published by Jolpica. The 2027
 * calendar is not published yet, so the rollover cases use a stated
 * hypothetical opener (14 March 2027) and assert only the season labels.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSeasonContext, isSeasonFinished, type SeasonRace } from '@apex/api-client/jolpica';
import { weekendDates, weekendSessions, weekendPhase, zoneOffsetMinutes } from '../../components/race/weekend';
import { homePhase, homeSectionOrder } from '../../components/home/weekend';
import { livePhase, nextPhaseChangeAt } from '../../lib/data-freshness';
import { calendarFocusIndex } from '../../lib/calendar-window';

const ZONES = ['UTC', 'America/Los_Angeles', 'America/Mexico_City', 'Europe/London', 'Asia/Kolkata'];
const at = (iso: string) => Date.parse(iso);

function inEveryZone(run: (zone: string) => void) {
  const original = process.env.TZ;
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      run(zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

// Real 2026 R18 (Austin) sessions, Jolpica UTC times.
const AUSTIN = [
  { kind: 'FP1', iso: '2026-10-23T17:30:00Z' },
  { kind: 'FP2', iso: '2026-10-23T21:00:00Z' },
  { kind: 'FP3', iso: '2026-10-24T17:30:00Z' },
  { kind: 'Q', iso: '2026-10-24T21:00:00Z' },
  { kind: 'R', iso: '2026-10-25T20:00:00Z' },
];
const SEASON_2026: SeasonRace[] = [
  { round: 18, raceStartIso: '2026-10-25T20:00:00Z' },
  { round: 19, raceStartIso: '2026-11-01T20:00:00Z' },
  { round: 23, raceStartIso: '2026-12-06T13:00:00Z' },
];

test('weekend phases move FP1 -> FP2 -> race at the right instants, in every zone', () => {
  const phases = (iso: string) => weekendSessions(AUSTIN, at(iso)).map((s) => `${s.kind}:${s.phase}`).join(' ');
  inEveryZone((zone) => {
    assert.equal(phases('2026-10-23T17:29:59Z'), 'FP1:next FP2:upcoming FP3:upcoming Q:upcoming R:upcoming', zone);
    assert.equal(phases('2026-10-23T17:30:00Z'), 'FP1:under-way FP2:upcoming FP3:upcoming Q:upcoming R:upcoming', zone);
    // R3-TIME-6: once FP1's window ends, FP2 is next (not FP1 still "next").
    assert.equal(phases('2026-10-23T18:30:00Z'), 'FP1:finished FP2:next FP3:upcoming Q:upcoming R:upcoming', zone);
    assert.equal(phases('2026-10-25T21:59:59Z').endsWith('R:under-way'), true, zone);
    assert.equal(phases('2026-10-25T22:00:00Z').endsWith('R:finished'), true, zone);
    assert.equal(weekendPhase(weekendSessions(AUSTIN, at('2026-10-23T12:00:00Z'))), 'upcoming', zone);
    assert.equal(weekendPhase(weekendSessions(AUSTIN, at('2026-10-24T12:00:00Z'))), 'in-progress', zone);
    assert.equal(weekendPhase(weekendSessions(AUSTIN, at('2026-10-26T00:00:00Z'))), 'finished', zone);
  });
});

test('an OpenF1 end time and a moved start override the regulation window', () => {
  inEveryZone((zone) => {
    // Red flag: the race ran past two hours; OpenF1 publishes the real end.
    const openf1 = [{ session_name: 'Race', date_start: '2026-10-25T20:00:00Z', date_end: '2026-10-25T22:41:00Z' }];
    const race = weekendSessions(AUSTIN, at('2026-10-25T22:30:00Z'), openf1).at(-1)!;
    assert.equal(race.phase, 'under-way', zone);
    // Miami 2026 pattern: the race started three hours before Jolpica's listed time.
    const moved = [{ session_name: 'Race', date_start: '2026-10-25T17:00:00Z', date_end: '2026-10-25T18:40:00Z' }];
    const r = weekendSessions(AUSTIN, at('2026-10-25T19:00:00Z'), moved).at(-1)!;
    assert.equal(r.iso, '2026-10-25T17:00:00Z', zone);
    assert.equal(r.scheduledIso, '2026-10-25T20:00:00Z', zone);
    assert.equal(r.phase, 'finished', zone);
  });
});

test('home phase: weekend from FP1, result-in for 96 h after the race, then build-up', () => {
  inEveryZone((zone) => {
    const next = { sessions: weekendSessions(AUSTIN, at('2026-10-20T00:00:00Z')) };
    const previous = { raceStartIso: '2026-10-25T20:00:00Z' };
    assert.equal(homePhase(next, null, at('2026-10-23T17:29:00Z')), 'build-up', zone);
    assert.equal(homePhase(next, null, at('2026-10-23T17:30:00Z')), 'weekend', zone);
    const mexico = { sessions: weekendSessions([{ kind: 'FP1', iso: '2026-10-30T18:30:00Z' }, { kind: 'R', iso: '2026-11-01T20:00:00Z' }], at('2026-10-26T00:00:00Z')) };
    assert.equal(homePhase(mexico, previous, at('2026-10-26T09:00:00Z')), 'result-in', zone);
    assert.deepEqual(homeSectionOrder('result-in')[0], 'last-race', zone);
    assert.equal(homePhase(mexico, previous, at('2026-10-29T20:00:00Z')), 'build-up', zone);
    assert.equal(homePhase(mexico, previous, at('2026-10-30T18:30:00Z')), 'weekend', zone);
  });
});

test('live phase and the next phase change: polling stops once results are due and in', () => {
  inEveryZone((zone) => {
    const race = { kind: 'R', startIso: '2026-10-25T20:00:00Z' };
    assert.equal(livePhase(race, at('2026-10-25T19:59:59Z'), false), 'before', zone);
    assert.equal(livePhase(race, at('2026-10-25T21:00:00Z'), false), 'under-way', zone);
    assert.equal(livePhase(race, at('2026-10-25T23:00:00Z'), false), 'awaiting-results', zone);
    assert.equal(livePhase(race, at('2026-10-25T23:00:00Z'), true), 'results-in', zone);
    assert.equal(livePhase(race, at('2026-10-26T04:00:00Z'), false), 'finished', zone);
    assert.equal(nextPhaseChangeAt([race], at('2026-10-25T19:00:00Z')), at('2026-10-25T20:00:00Z'), zone);
    assert.equal(nextPhaseChangeAt([race], at('2026-10-25T21:00:00Z')), at('2026-10-25T22:00:00Z'), zone);
    assert.equal(nextPhaseChangeAt([race], at('2026-10-25T23:00:00Z'), new Set(['R'])), null, zone);
  });
});

test('calendar focus moves to the next round 3 h after a race start', () => {
  inEveryZone((zone) => {
    assert.equal(calendarFocusIndex(SEASON_2026, at('2026-10-25T22:59:59Z')), 0, zone);
    assert.equal(calendarFocusIndex(SEASON_2026, at('2026-10-25T23:00:00Z')), 1, zone);
    assert.equal(calendarFocusIndex(SEASON_2026, at('2026-12-06T16:00:00Z')), -1, zone);
  });
});

test('season rollover: 2026-12-10, 2027-01-15 and 2027-03-20 give consistent season labels', () => {
  inEveryZone((zone) => {
    // 10 Dec 2026: Abu Dhabi has run and the standings include round 23.
    const dec = resolveSeasonContext({ now: at('2026-12-10T12:00:00Z'), calendar: { season: 2026, races: SEASON_2026 }, standings: { season: 2026, round: 23 } });
    // The final race counts as run 3 h after its start, not at lights out.
    assert.equal(isSeasonFinished(SEASON_2026, at('2026-12-06T15:59:59Z')), false, zone);
    assert.equal(isSeasonFinished(SEASON_2026, at('2026-12-06T16:00:00Z')), true, zone);
    assert.equal(isSeasonFinished(SEASON_2026, at('2026-12-10T12:00:00Z')), true, zone);
    assert.deepEqual([dec.activeSeason, dec.resultsSeason, dec.lastCompletedSeason, dec.resultsSeasonConfirmed], [2026, 2026, 2026, true], zone);
    // ...but not before the deciding round is in the standings.
    const pending = resolveSeasonContext({ now: at('2026-12-06T18:00:00Z'), calendar: { season: 2026, races: SEASON_2026 }, standings: { season: 2026, round: 22 } });
    assert.equal(pending.lastCompletedSeason, 2025, zone);

    // 15 Jan 2027: the 2027 calendar is the current one, nothing has run yet.
    const opener: SeasonRace[] = [{ round: 1, raceStartIso: '2027-03-14T04:00:00Z' }, { round: 24, raceStartIso: '2027-12-05T13:00:00Z' }];
    const jan = resolveSeasonContext({ now: at('2027-01-15T12:00:00Z'), calendar: { season: 2027, races: opener, previous: { season: 2026, round: 23, raceStartIso: '2026-12-06T13:00:00Z' } }, standings: { season: 2026, round: 23 } });
    assert.deepEqual([jan.activeSeason, jan.resultsSeason, jan.lastCompletedSeason], [2027, 2026, 2026], zone);
    // 15 Jan 2027 with the provider down: never print a guessed season as confirmed.
    const down = resolveSeasonContext({ now: at('2027-01-15T12:00:00Z'), calendar: null, standings: null });
    assert.deepEqual([down.resultsSeason, down.resultsSeasonConfirmed], [2026, false], zone);

    // 20 Mar 2027: round 1 has run and its standings are published.
    const mar = resolveSeasonContext({ now: at('2027-03-20T12:00:00Z'), calendar: { season: 2027, races: opener }, standings: { season: 2027, round: 1 } });
    assert.deepEqual([mar.activeSeason, mar.resultsSeason, mar.lastCompletedSeason], [2027, 2027, 2026], zone);
  });
});

test('DST weekends: offsets follow the instant, not the weekend (Mexico 2022, Austin 2026 for a London viewer)', () => {
  inEveryZone((zone) => {
    // R3-TIME-5: Mexico left DST on 30 Oct 2022, during its Grand Prix weekend.
    assert.equal(zoneOffsetMinutes('America/Mexico_City', '2022-10-28T18:00:00Z'), -300, zone);
    assert.equal(zoneOffsetMinutes('America/Mexico_City', '2022-10-30T20:00:00Z'), -360, zone);
    // Europe left DST on 25 Oct 2026, the Sunday of the Austin weekend.
    assert.equal(zoneOffsetMinutes('Europe/London', '2026-10-23T17:30:00Z'), 60, zone);
    assert.equal(zoneOffsetMinutes('Europe/London', '2026-10-25T20:00:00Z'), 0, zone);
    assert.equal(zoneOffsetMinutes('America/Chicago', '2026-10-25T20:00:00Z'), -300, zone);
    assert.equal(zoneOffsetMinutes('Asia/Kolkata', '2026-10-25T20:00:00Z'), 330, zone);
    // Dates print in the zone asked for, whatever the server's zone (weekendDates is the formatter the
    // race and schedule pages use; the old lib/format formatDateRange was dead code and was removed in R3-CODE-6).
    assert.equal(weekendDates('2026-12-04T09:30:00Z', '2026-12-06T13:00:00Z', 'Asia/Dubai'), '4–6 Dec 2026', zone);
    assert.equal(weekendDates('2026-10-23T23:30:00Z', '2026-10-23T23:30:00Z', 'Asia/Kolkata'), '24 Oct 2026', zone);
    assert.equal(weekendDates('2026-10-23T23:30:00Z', '2026-10-23T23:30:00Z', 'America/Los_Angeles'), '23 Oct 2026', zone);
    // Las Vegas 2026: Thursday 19 to Saturday 21 November locally, Friday 20 to Sunday 22 in UTC.
    assert.equal(weekendDates('2026-11-20T00:30:00Z', '2026-11-22T04:00:00Z', 'America/Los_Angeles'), '19–21 Nov 2026', zone);
  });
});
