import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOn, completedSeasonFloor, finalRace, isSeasonFinished, resolveLastCompletedSeason, selectSyncSeasons } from './season';

const races = [{ round: 1, raceStartIso: '2026-03-08T04:00:00Z' }, { round: 3, raceStartIso: '2026-12-06T13:00:00Z' }, { round: 2, raceStartIso: '2026-10-25T19:00:00Z' }];

test('final race is the highest round; a season finishes 3 h after its final start; empty never finishes', () => {
  assert.deepEqual(finalRace(races), { round: 3, startMs: Date.parse('2026-12-06T13:00:00Z') });
  assert.equal(isSeasonFinished(races, Date.parse('2026-12-06T15:59:59Z')), false);
  assert.equal(isSeasonFinished(races, Date.parse('2026-12-06T16:00:00Z')), true);
  assert.equal(isSeasonFinished([], Date.parse('2030-01-01T00:00:00Z')), false);
  assert.equal(finalRace([{ round: 1, raceStartIso: 'not a date' }]), null);
});

test('the completed floor is the previous calendar year, the only clock-derived bound', () => {
  assert.equal(completedSeasonFloor(Date.parse('2027-01-01T00:00:00Z')), 2026);
  assert.equal(completedSeasonFloor(Date.parse('2026-12-31T23:59:59Z')), 2025);
});

test('last completed season needs the finale classified and never goes below the floor', () => {
  const calendar = { season: 2026, races };
  const now = Date.parse('2026-12-10T00:00:00Z');
  assert.equal(resolveLastCompletedSeason({ now, calendar, standings: { season: 2026, round: 3 } }), 2026);
  assert.equal(resolveLastCompletedSeason({ now, calendar, standings: { season: 2026, round: 2 } }), 2025);
  assert.equal(resolveLastCompletedSeason({ now, calendar, standings: null }), 2025);
  assert.equal(resolveLastCompletedSeason({ now, calendar: null, standings: null }), 2025);
  // Rolled forward: the previous season's final round comes from `previous`.
  const rolled = { season: 2027, races: [{ round: 1, raceStartIso: '2027-03-14T04:00:00Z' }], previous: { season: 2026, round: 3, raceStartIso: '2026-12-06T13:00:00Z' } };
  assert.equal(resolveLastCompletedSeason({ now, calendar: rolled, standings: { season: 2026, round: 3 } }), 2026);
  assert.equal(resolveLastCompletedSeason({ now, calendar: rolled, standings: { season: 2026, round: 2 } }), 2025);
});

test('sync selection keeps the previous season only inside 30 days of its final race', () => {
  const active = { season: 2027, races: [{ round: 1, raceStartIso: '2027-03-14T04:00:00Z' }] };
  const previous = { season: 2026, races };
  assert.deepEqual(selectSyncSeasons({ now: Date.parse('2027-01-05T12:59:59Z'), active, previous }), [2026, 2027]);
  assert.deepEqual(selectSyncSeasons({ now: Date.parse('2027-01-05T13:00:00Z'), active, previous }), [2027]);
  assert.deepEqual(selectSyncSeasons({ now: Date.parse('2026-12-10T00:00:00Z'), active: previous, previous: null }), [2026]);
});

test('age counts by calendar date and rejects malformed input', () => {
  assert.equal(ageOn('1997-09-30', Date.parse('2026-09-29T23:59:59Z')), 28);
  assert.equal(ageOn('1997-09-30', Date.parse('2026-09-30T00:00:00Z')), 29);
  assert.equal(ageOn('unknown', Date.now()), null);
  assert.equal(ageOn('2030-01-01', Date.parse('2026-01-01T00:00:00Z')), null);
});

test('D2-RESILIENCE-3: with Jolpica down the season context says the results season is unconfirmed', async () => {
  const { resolveSeasonContext } = await import('./season');
  const now = Date.parse('2026-10-25T12:00:00Z');
  const down = resolveSeasonContext({ now, calendar: null, standings: null });
  assert.equal(down.resultsSeasonConfirmed, false);
  assert.equal(down.resultsSeason, 2025);
  const up = resolveSeasonContext({ now, calendar: null, standings: { season: 2026, round: 19 } });
  assert.equal(up.resultsSeasonConfirmed, true);
  assert.equal(up.resultsSeason, 2026);
});
