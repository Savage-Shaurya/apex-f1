import { cache } from 'react';
import {
  ageOn,
  jolpica,
  resolveSeasonContext,
  type FetchOpts,
  type SeasonContextFacts,
} from '@apex/api-client/jolpica';
import { readCalendar, readCurrentStandings, type PublicCalendar } from './public-sport';

/**
 * One season source of truth for every page, link and label.
 *
 * Seasons come from the real Jolpica calendar and standings, never from the
 * clock year. The rules live in `@apex/api-client/jolpica` (season.ts) so the
 * nightly worker uses exactly the same definitions.
 *
 *  - activeSeason: the season the site is about (calendar season with races,
 *    otherwise the latest standings season).
 *  - calendarSeason: exactly what /schedule shows (null when unreadable).
 *  - resultsSeason: the season whose standings tables are live; results
 *    links, rosters and team windows follow it.
 *  - lastCompletedSeason: the newest season whose final round has run and is
 *    classified; champions pages count titles through it.
 */
export type SeasonContext = SeasonContextFacts;

type StandingsFacts = { state: 'available' | 'unavailable'; season: number | null; round: number | null };

/** Pure join used by the request loader and tests. */
export function seasonContextFrom(now: number, calendar: PublicCalendar, standings: StandingsFacts): SeasonContext {
  // An unavailable calendar can still carry the confirmed current season (only the
  // next-year lookup failed). Those races still date the finale, but /schedule shows
  // the outage, so the nav must not print a calendar year.
  const usable = calendar.state === 'available' || calendar.races.length > 0;
  const context = resolveSeasonContext({
    now,
    calendar: usable ? { season: calendar.season, races: calendar.races, previous: calendar.previous } : null,
    standings: standings.state === 'available' ? { season: standings.season, round: standings.round } : null,
  });
  return calendar.state === 'available' ? context : { ...context, calendarSeason: null };
}

type StandingsReader = (season: number | 'current', options: FetchOpts) => Promise<{ season: string | null; round: number | null; standings: unknown[] }>;
export interface SeasonSources {
  now?: number;
  calendarProvider?: Parameters<typeof readCalendar>[0];
  standings?: StandingsReader;
}

/** Uncached loader with injectable clock and providers (tests, scripts). */
export async function loadSeasonContext(sources: SeasonSources = {}): Promise<SeasonContext> {
  const now = sources.now ?? Date.now();
  const [calendar, standings] = await Promise.all([
    readCalendar(sources.calendarProvider ?? jolpica, now),
    readCurrentStandings(sources.standings ?? jolpica.getDriverStandingsSnapshot, now, sources.calendarProvider ?? jolpica),
  ]);
  return seasonContextFrom(now, calendar, {
    state: standings.state,
    season: standings.snapshot?.season ? Number(standings.snapshot.season) : null,
    round: standings.snapshot?.round ?? null,
  });
}

/**
 * Per-request season context. It reuses the request's cached calendar and
 * standings reads (lib/grid), so it adds no provider requests of its own.
 */
export const getSeasonContext = cache(async (): Promise<SeasonContext> => {
  const { getCalendar, getStandingsSeason } = await import('./grid');
  const [calendar, standings] = await Promise.all([getCalendar(), getStandingsSeason()]);
  return seasonContextFrom(calendar.now, calendar, standings);
});

/**
 * Season context for the root layout's shell (nav, footer). Same data as
 * getSeasonContext, but a provider outage never makes the route dynamic, so
 * one failed read cannot switch every page off ISR.
 */
export const getShellSeasonContext = cache(async (): Promise<SeasonContext> => {
  const { getShellCalendar, getShellStandingsSeason } = await import('./grid');
  const [calendar, standings] = await Promise.all([getShellCalendar(), getShellStandingsSeason()]);
  return seasonContextFrom(calendar.now, calendar, standings);
});

/** The season the site is about right now. Pass `sources` to resolve another date (uncached). */
export async function getActiveSeason(sources?: SeasonSources): Promise<number> {
  return (sources ? await loadSeasonContext(sources) : await getSeasonContext()).activeSeason;
}

/** The newest season whose final round is in the past and classified. Pass `now` to resolve another date (uncached). */
export async function lastCompletedSeason(sources?: SeasonSources): Promise<number> {
  return (sources ? await loadSeasonContext(sources) : await getSeasonContext()).lastCompletedSeason;
}

/** Seasons a team's recent-results strip reads, newest first. */
export function recentSeasonWindow(latest: number, length: number): number[] {
  return Array.from({ length: Math.max(0, length) }, (_, index) => latest - index).filter((year) => year >= 1950);
}

/** Drivers who raced for the team in the live standings season. */
export function currentRosterOf<T extends { lastSeason: number }>(roster: Iterable<T>, resultsSeason: number): T[] {
  return Array.from(roster).filter((driver) => driver.lastSeason === resultsSeason);
}

/**
 * Age is shown only for drivers on the current grid. Between seasons the
 * grid is the latest standings season, so current drivers keep their age
 * over the winter instead of losing it on 1 January.
 */
export function currentDriverAge(input: {
  dob: string | null | undefined;
  onCurrentGrid: boolean;
  latestSeason: number | null | undefined;
  resultsSeason: number;
  now: number;
}): number | null {
  if (!input.dob) return null;
  const current = input.onCurrentGrid || (input.latestSeason != null && input.latestSeason >= input.resultsSeason);
  return current ? ageOn(input.dob, input.now) : null;
}
