import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JolpicaRace } from '@apex/api-client/jolpica';
import { readCalendar } from '@/lib/public-sport';
import { lastRaceCandidates } from './weekend';

// Test fixtures only: shaped like Jolpica schedule rows.
const race = (season: number, round: number, date: string): JolpicaRace => ({
  season: String(season), round: String(round), raceName: `Fixture ${round}`, date, time: '13:00:00Z', url: '',
  Circuit: { circuitId: `fixture_${round}`, circuitName: 'Fixture Circuit', url: '', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } },
});
const season2026 = [race(2026, 1, '2026-03-08'), race(2026, 2, '2026-10-25'), race(2026, 3, '2026-12-06')];
const season2027 = [race(2027, 1, '2027-03-14'), race(2027, 2, '2027-04-04')];

test('R3-TIME-2: the home "Last race" keeps the 2026 finale all winter after Jolpica rolls "current" to 2027', async () => {
  const provider = {
    getSchedule: async (season: number | 'current' = 'current') => (season === 'current' ? season2027 : season === 2026 ? season2026 : []),
  };
  for (const now of ['2026-12-10T12:00:00Z', '2027-01-15T12:00:00Z', '2027-03-13T12:00:00Z']) {
    const calendar = await readCalendar(provider, Date.parse(now));
    const candidates = lastRaceCandidates(calendar);
    assert.deepEqual(candidates.map((r) => [r.season, r.round]), [[2026, 3]], now);
  }
  // After 2027 round 1 has started, today's race comes first, then nothing older is needed.
  const raceDay = await readCalendar(provider, Date.parse('2027-03-20T12:00:00Z'));
  assert.deepEqual(lastRaceCandidates(raceDay).map((r) => [r.season, r.round]), [[2027, 1]]);
});

test('R3-TIME-2: an empty new "current" season still offers the previous season\'s finale', async () => {
  const provider = {
    getSchedule: async (season: number | 'current' = 'current') => (season === 2026 ? season2026 : []),
    getScheduleSnapshot: async (season: number | 'current' = 'current') => ({ season: season === 'current' ? 2027 : season, races: season === 2026 ? season2026 : [] }),
  };
  const calendar = await readCalendar(provider, Date.parse('2026-12-20T12:00:00Z'));
  assert.equal(calendar.season, 2027);
  assert.deepEqual(lastRaceCandidates(calendar).map((r) => [r.season, r.round]), [[2026, 3]]);
});
