import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seasonStatusFromCalendar } from './ingestion';

const race = (iso: string) => ({ raceStartIso: iso });
const season = [race('2026-03-08T04:00:00Z'), race('2026-07-05T14:00:00Z'), race('2026-12-06T13:00:00Z')];

test('season status follows the calendar, never the clock year', () => {
  assert.equal(seasonStatusFromCalendar(season, Date.parse('2026-02-01T00:00:00Z')), 'upcoming');
  assert.equal(seasonStatusFromCalendar(season, Date.parse('2026-10-25T00:00:00Z')), 'active');
  // Finale ran in December: completed the same calendar year.
  assert.equal(seasonStatusFromCalendar(season, Date.parse('2026-12-06T16:00:01Z')), 'completed');
  // Within the 3 h grace the finale has not finished yet.
  assert.equal(seasonStatusFromCalendar(season, Date.parse('2026-12-06T15:00:00Z')), 'active');
  // A season that runs into the new year is still active in January.
  assert.equal(seasonStatusFromCalendar([race('2026-12-20T13:00:00Z'), race('2027-01-10T13:00:00Z')], Date.parse('2027-01-02T00:00:00Z')), 'active');
  assert.equal(seasonStatusFromCalendar([], Date.now()), 'upcoming');
});
