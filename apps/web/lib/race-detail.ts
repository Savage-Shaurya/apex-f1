import type { Metadata } from 'next';
import { jolpica, mapRace, mapResult, resolveRaceRoute, type UiRace, type UiResult } from '@apex/api-client/jolpica';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { isKnownRaceRouteKey } from './circuits/known-ids';
import { providerOutage } from './provider-outage';
import { raceReadTtlSeconds } from './data-freshness';

type RaceProvider = Pick<typeof jolpica, 'getSchedule' | 'getRaceResults'>;
export type RaceCalendarState =
  | { state: 'found'; race: UiRace; races: UiRace[] }
  | { state: 'missing' }
  | { state: 'unavailable' };
export type RaceResultsState =
  | { state: 'available'; results: UiResult[] }
  | { state: 'unavailable' };

const routeKey = /^[a-zA-Z0-9_-]{1,160}$/;
const unavailableCodes = new Set(['http', 'network', 'timeout', 'rate-limit', 'invalid-response', 'incomplete', 'configuration']);
function isUnavailable(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return false;
  if (error.provider === 'jolpica') return unavailableCodes.has(error.code);
  // The shared bounded body reader preserves these transport-origin failures.
  return error.provider === 'response' && (error.code === 'invalid-response' || error.code === 'timeout');
}

/** One validated calendar identity, shared by the route and its metadata. */
export async function loadRaceCalendar(season: number, key: string, provider: RaceProvider = jolpica): Promise<RaceCalendarState> {
  if (!Number.isInteger(season) || season < 1950 || season > new Date().getUTCFullYear() + 1 || !routeKey.test(key)) return { state: 'missing' };
  let raw: Awaited<ReturnType<RaceProvider['getSchedule']>>;
  try { raw = await provider.getSchedule(season, { revalidate: 3600, strict: true }); }
  catch (error) {
    if (!isUnavailable(error)) throw error;
    // Without the calendar, a key naming no circuit that ever hosted a race is
    // still confirmed absent: answer 404 rather than a "try again" 200.
    return isKnownRaceRouteKey(key) ? { state: 'unavailable' } : { state: 'missing' };
  }
  // A response for another season cannot establish absence in this season.
  if (raw.some((race) => Number(race.season) !== season)) return { state: 'unavailable' };
  // Mapping failures remain coding/schema errors, not fabricated empty data.
  const races = raw.map(mapRace);
  const race = resolveRaceRoute(races, key);
  return race ? { state: 'found', race, races } : { state: 'missing' };
}

/** Successful empty results and an unavailable classification are distinct. */
export async function loadRaceResults(race: UiRace, provider: RaceProvider = jolpica, now = Date.now()): Promise<RaceResultsState> {
  let raw: Awaited<ReturnType<RaceProvider['getRaceResults']>>;
  try { raw = await provider.getRaceResults(race.season, race.round, { revalidate: raceReadTtlSeconds(race, now), strict: true }); }
  catch (error) {
    if (!isUnavailable(error)) throw error;
    return { state: 'unavailable' };
  }
  return { state: 'available', results: raw ? raw.results.map(mapResult) : [] };
}

/**
 * Calendar-only metadata never starts classification or image work. An
 * outage throws (route error boundary, HTTP 500; ISR keeps the last good
 * page) instead of a 200 noindex that would deindex a good race page.
 */
export function raceDetailMetadata(calendar: RaceCalendarState): Metadata {
  if (calendar.state === 'unavailable') providerOutage('race calendar');
  if (calendar.state === 'missing') return { title: 'Race not found', robots: { index: false, follow: true } };
  const { race } = calendar;
  return {
    title: `${race.name} ${race.season}`,
    description: `${race.name} ${race.season} · sessions, results, circuit, weather.`,
    alternates: { canonical: `/schedule/${race.season}/${race.routeSlug ?? race.slug}` },
  };
}
