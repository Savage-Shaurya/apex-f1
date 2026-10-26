import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JolpicaRace } from '@apex/api-client/jolpica';
import { navSections, searchSeasonSuggestions } from '../components/ds/shell/nav-config';
import { currentDriverAge, currentRosterOf, loadSeasonContext, recentSeasonWindow, type SeasonContext } from './season';

// Test fixtures only: shaped like Jolpica responses, never rendered.
const race = (season: number, round: number, date: string): JolpicaRace => ({
  season: String(season), round: String(round), raceName: `Fixture ${round}`, date, time: '13:00:00Z', url: '',
  Circuit: { circuitId: `fixture_${round}`, circuitName: 'Fixture Circuit', url: '', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } },
});
const season2026 = [race(2026, 1, '2026-03-08'), race(2026, 2, '2026-10-25'), race(2026, 3, '2026-12-06')];
const season2027 = [race(2027, 1, '2027-03-14'), race(2027, 2, '2027-04-04')];

type Snapshot = { season: string | null; round: number | null; standings: unknown[] };
const table = (season: number, round: number): Snapshot => ({ season: String(season), round, standings: [{ points: 1 }] });
const empty: Snapshot = { season: null, round: null, standings: [] };

function sources(now: string, calendars: Record<string, JolpicaRace[]>, standings: Record<string, Snapshot>, declared?: number) {
  const getSchedule = async (season: number | 'current' = 'current') => calendars[String(season)] ?? [];
  return {
    now: Date.parse(now),
    // `declared`: the season Jolpica names for "current" even before its calendar has races.
    calendarProvider: declared === undefined ? { getSchedule } : { getSchedule, getScheduleSnapshot: async (season: number | 'current' = 'current') => ({ season: season === 'current' ? declared : season, races: await getSchedule(season) }) },
    standings: async (season: number | 'current') => standings[String(season)] ?? empty,
  };
}

const scenarios: Array<{ name: string; now: string; calendars: Record<string, JolpicaRace[]>; standings: Record<string, Snapshot>; declared?: number; expect: Omit<SeasonContext, 'now'> }> = [
  {
    name: '2026-12-10, finale classified, 2027 calendar published',
    now: '2026-12-10T12:00:00Z', calendars: { current: season2026, 2027: season2027 }, standings: { current: table(2026, 3) },
    expect: { calendarSeason: 2027, activeSeason: 2027, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2026-12-10, finale classified, no 2027 calendar yet',
    now: '2026-12-10T12:00:00Z', calendars: { current: season2026 }, standings: { current: table(2026, 3) },
    expect: { calendarSeason: 2026, activeSeason: 2026, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2026-12-06 evening, finale run but standings still on the previous round',
    now: '2026-12-06T18:00:00Z', calendars: { current: season2026 }, standings: { current: table(2026, 2) },
    expect: { calendarSeason: 2026, activeSeason: 2026, resultsSeason: 2026, lastCompletedSeason: 2025, resultsSeasonConfirmed: true },
  },
  {
    name: '2027-01-15, Jolpica current still 2026, 2027 calendar published',
    now: '2027-01-15T12:00:00Z', calendars: { current: season2026, 2027: season2027 }, standings: { current: table(2026, 3) },
    expect: { calendarSeason: 2027, activeSeason: 2027, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2027-01-15, Jolpica current is an empty 2027',
    now: '2027-01-15T12:00:00Z', calendars: { current: [] }, standings: { current: empty, 2026: table(2026, 3) },
    expect: { calendarSeason: 2027, activeSeason: 2026, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2027-03-20, after round 1 of 2027',
    now: '2027-03-20T12:00:00Z', calendars: { current: season2027 }, standings: { current: table(2027, 1) },
    expect: { calendarSeason: 2027, activeSeason: 2027, resultsSeason: 2027, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  // R3-TIME-2: Jolpica's "current" rolls to 2027 before the clock does.
  {
    name: '2026-12-10, Jolpica current already 2027 with its calendar (2026 finale classified)',
    now: '2026-12-10T12:00:00Z', calendars: { current: season2027, 2026: season2026 }, standings: { current: empty, 2026: table(2026, 3) },
    expect: { calendarSeason: 2027, activeSeason: 2027, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2027-01-15, Jolpica current is 2027 with its calendar (next is round 1)',
    now: '2027-01-15T12:00:00Z', calendars: { current: season2027, 2026: season2026 }, standings: { current: empty, 2026: table(2026, 3) },
    expect: { calendarSeason: 2027, activeSeason: 2027, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
  {
    name: '2026-12-20, Jolpica current is an empty 2027 (no calendar yet)',
    now: '2026-12-20T12:00:00Z', calendars: { current: [], 2026: season2026 }, standings: { current: empty, 2026: table(2026, 3) }, declared: 2027,
    expect: { calendarSeason: 2027, activeSeason: 2026, resultsSeason: 2026, lastCompletedSeason: 2026, resultsSeasonConfirmed: true },
  },
];

for (const scenario of scenarios) {
  test(`season context: ${scenario.name}`, async () => {
    const context = await loadSeasonContext(sources(scenario.now, scenario.calendars, scenario.standings, scenario.declared));
    assert.deepEqual({ ...context, now: undefined }, { ...scenario.expect, now: undefined });
  });
}

test('mid-season (2026-10-25): standings season is live and champions count through 2025', async () => {
  const context = await loadSeasonContext(sources('2026-10-25T09:00:00Z', { current: season2026 }, { current: table(2026, 1) }));
  assert.equal(context.activeSeason, 2026); assert.equal(context.resultsSeason, 2026); assert.equal(context.lastCompletedSeason, 2025);
});

test('provider outage never invents a season: calendar label drops its year, links use the safe completed floor', async () => {
  const failing = { getSchedule: async () => { const { ProviderError } = await import('../../../packages/api-client/src/transport'); throw new ProviderError('jolpica', 'network'); } };
  const context = await loadSeasonContext({ now: Date.parse('2027-01-15T12:00:00Z'), calendarProvider: failing, standings: failing.getSchedule as never });
  assert.equal(context.calendarSeason, null);
  assert.equal(context.resultsSeason, 2026); assert.equal(context.lastCompletedSeason, 2026);
  const schedule = navSections({ calendar: context.calendarSeason, results: context.resultsSeason }).find((section) => section.label === 'Schedule')!;
  assert.equal(schedule.links[0]!.label, 'Race calendar');
  assert.doesNotMatch(schedule.blurb, /\d{4}/);
});

test('a failed next-year lookup after the finale keeps the classified 2026 title but drops the calendar year', async () => {
  const { ProviderError } = await import('../../../packages/api-client/src/transport');
  const context = await loadSeasonContext({
    now: Date.parse('2026-12-10T12:00:00Z'),
    calendarProvider: { getSchedule: async (season: number | 'current' = 'current') => { if (season === 'current') return season2026; throw new ProviderError('jolpica', 'network'); } },
    standings: async () => table(2026, 3),
  });
  assert.equal(context.calendarSeason, null);
  assert.equal(context.lastCompletedSeason, 2026); assert.equal(context.resultsSeason, 2026); assert.equal(context.activeSeason, 2026);
});

test('nav labels and links follow the calendar and standings seasons, never the clock year', async () => {
  const cases: Array<{ now: string; calendars: Record<string, JolpicaRace[]>; standings: Record<string, Snapshot>; calendarLabel: string; results: number }> = [
    { now: '2026-12-10T12:00:00Z', calendars: { current: season2026, 2027: season2027 }, standings: { current: table(2026, 3) }, calendarLabel: '2027 calendar', results: 2026 },
    { now: '2027-01-15T12:00:00Z', calendars: { current: [] }, standings: { current: empty, 2026: table(2026, 3) }, calendarLabel: '2027 calendar', results: 2026 },
    { now: '2027-03-20T12:00:00Z', calendars: { current: season2027 }, standings: { current: table(2027, 1) }, calendarLabel: '2027 calendar', results: 2027 },
  ];
  for (const item of cases) {
    const context = await loadSeasonContext(sources(item.now, item.calendars, item.standings));
    const nav = navSections({ calendar: context.calendarSeason, results: context.resultsSeason });
    const byLabel = (label: string) => nav.find((section) => section.label === label)!;
    assert.equal(byLabel('Schedule').links[0]!.label, item.calendarLabel, item.now);
    assert.equal(byLabel('Results').href, `/results/${item.results}/drivers`, item.now);
    assert.deepEqual(byLabel('Results').links.slice(0, 2).map((link) => link.href), [`/results/${item.results}/drivers`, `/results/${item.results}/teams`]);
    assert.equal(byLabel('Teams').links[0]!.label, `${item.results} teams`);
    assert.deepEqual(searchSeasonSuggestions({ calendar: context.calendarSeason, results: context.resultsSeason }).map((link) => link.href), [`/results/${item.results}/drivers`, `/results/${item.results}/teams`]);
  }
});

test('team roster and history window stay on the latest classified season across New Year', async () => {
  const roster = [
    { slug: 'driver_a', lastSeason: 2026 },
    { slug: 'driver_b', lastSeason: 2026 },
    { slug: 'driver_c', lastSeason: 2025 },
    { slug: 'driver_d', lastSeason: 2027 },
  ];
  const at = async (now: string, calendars: Record<string, JolpicaRace[]>, standings: Record<string, Snapshot>) => (await loadSeasonContext(sources(now, calendars, standings))).resultsSeason;
  const december = await at('2026-12-10T12:00:00Z', { current: season2026, 2027: season2027 }, { current: table(2026, 3) });
  const january = await at('2027-01-15T12:00:00Z', { current: [] }, { current: empty, 2026: table(2026, 3) });
  const march = await at('2027-03-20T12:00:00Z', { current: season2027 }, { current: table(2027, 1) });
  assert.deepEqual(currentRosterOf(roster.filter((driver) => driver.lastSeason <= 2026), december).map((driver) => driver.slug), ['driver_a', 'driver_b']);
  assert.deepEqual(currentRosterOf(roster.filter((driver) => driver.lastSeason <= 2026), january).map((driver) => driver.slug), ['driver_a', 'driver_b']);
  assert.deepEqual(currentRosterOf(roster, march).map((driver) => driver.slug), ['driver_d']);
  assert.deepEqual(recentSeasonWindow(january, 3), [2026, 2025, 2024]);
  assert.deepEqual(recentSeasonWindow(march, 10), [2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
  assert.deepEqual(recentSeasonWindow(1951, 3), [1951, 1950]);
});

test('driver age is shown for the current grid through the winter and counts birthdays by calendar date', () => {
  const dob = '1997-09-30';
  // 2026-12-10 and 2027-01-15: results season 2026, driver raced in 2026.
  assert.equal(currentDriverAge({ dob, onCurrentGrid: true, latestSeason: 2026, resultsSeason: 2026, now: Date.parse('2026-12-10T12:00:00Z') }), 29);
  assert.equal(currentDriverAge({ dob, onCurrentGrid: false, latestSeason: 2026, resultsSeason: 2026, now: Date.parse('2027-01-15T12:00:00Z') }), 29);
  // 2027-03-20: results season 2027; on the grid keeps age, a retired 2026 driver loses it.
  assert.equal(currentDriverAge({ dob, onCurrentGrid: true, latestSeason: 2026, resultsSeason: 2027, now: Date.parse('2027-03-20T12:00:00Z') }), 29);
  assert.equal(currentDriverAge({ dob, onCurrentGrid: false, latestSeason: 2026, resultsSeason: 2027, now: Date.parse('2027-03-20T12:00:00Z') }), null);
  // Birthday boundary: the day before and the day of.
  assert.equal(currentDriverAge({ dob: '2000-03-21', onCurrentGrid: true, latestSeason: 2027, resultsSeason: 2027, now: Date.parse('2027-03-20T23:00:00Z') }), 26);
  assert.equal(currentDriverAge({ dob: '2000-03-21', onCurrentGrid: true, latestSeason: 2027, resultsSeason: 2027, now: Date.parse('2027-03-21T00:00:00Z') }), 27);
  assert.equal(currentDriverAge({ dob: undefined, onCurrentGrid: true, latestSeason: 2027, resultsSeason: 2027, now: Date.parse('2027-03-20T12:00:00Z') }), null);
});

test('champions "through" includes the 2026 title once its finale is classified', async () => {
  const through = async (now: string, calendars: Record<string, JolpicaRace[]>, standings: Record<string, Snapshot>) => (await loadSeasonContext(sources(now, calendars, standings))).lastCompletedSeason;
  assert.equal(await through('2026-12-06T10:00:00Z', { current: season2026 }, { current: table(2026, 2) }), 2025);
  assert.equal(await through('2026-12-10T12:00:00Z', { current: season2026, 2027: season2027 }, { current: table(2026, 3) }), 2026);
  assert.equal(await through('2027-01-15T12:00:00Z', { current: [] }, { current: empty, 2026: table(2026, 3) }), 2026);
  assert.equal(await through('2027-03-20T12:00:00Z', { current: season2027 }, { current: table(2027, 1) }), 2026);
});
