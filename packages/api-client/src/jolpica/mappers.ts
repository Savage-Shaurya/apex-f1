// Map Jolpica raw shapes → @apex/types domain shapes.

import type {
  JolpicaRace,
  JolpicaDriver,
  JolpicaConstructor,
  JolpicaDriverStandingEntry,
  JolpicaConstructorStandingEntry,
  JolpicaResultEntry,
  JolpicaQualifyingEntry,
  JolpicaPitStopEntry,
  JolpicaLapTiming,
} from './types';

function isoFromDateTime(date: string, time?: string) {
  if (!date) return '';
  if (!time) return date;
  // Jolpica returns time as "HH:MM:SSZ" or "HH:MM:SS"
  return `${date}T${time.replace(/Z$/, '')}Z`;
}

export interface UiRace {
  slug: string;
  /** Public route identity; the established circuit/database slug stays unchanged. */
  routeSlug?: string;
  round: number;
  season: number;
  name: string;
  country: string;
  city: string;
  circuitName: string;
  circuitId: string;
  date: string;
  raceStartIso: string;
  sessions: Array<{ kind: string; iso: string }>;
  wikiUrl: string;
  circuitWikiUrl?: string;
  lat: number;
  lon: number;
}

export function raceRouteSlug(circuitId: string, round: number): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(circuitId) || !Number.isSafeInteger(round) || round < 1) throw new Error('Invalid race route identity.');
  return `${circuitId}-round-${round}`;
}

/** Canonical routes distinguish repeat venues; legacy circuit links resolve to the first round. */
export function resolveRaceRoute(races: readonly UiRace[], routeKey: string): UiRace | null {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(routeKey)) return null;
  const exact = races.find(race => (race.routeSlug ?? raceRouteSlug(race.circuitId, race.round)) === routeKey);
  if (exact) return exact;
  return races.filter(race => race.slug === routeKey).sort((a, b) => a.round - b.round)[0] ?? null;
}

export function mapRace(r: JolpicaRace): UiRace {
  const sessions: UiRace['sessions'] = [];
  if (r.FirstPractice) sessions.push({ kind: 'FP1', iso: isoFromDateTime(r.FirstPractice.date, r.FirstPractice.time) });
  if (r.SecondPractice) sessions.push({ kind: 'FP2', iso: isoFromDateTime(r.SecondPractice.date, r.SecondPractice.time) });
  if (r.ThirdPractice) sessions.push({ kind: 'FP3', iso: isoFromDateTime(r.ThirdPractice.date, r.ThirdPractice.time) });
  if (r.SprintQualifying) sessions.push({ kind: 'SQ', iso: isoFromDateTime(r.SprintQualifying.date, r.SprintQualifying.time) });
  if (r.Sprint) sessions.push({ kind: 'S', iso: isoFromDateTime(r.Sprint.date, r.Sprint.time) });
  if (r.Qualifying) sessions.push({ kind: 'Q', iso: isoFromDateTime(r.Qualifying.date, r.Qualifying.time) });
  sessions.push({ kind: 'R', iso: isoFromDateTime(r.date, r.time) });

  return {
    slug: r.Circuit.circuitId,
    routeSlug: raceRouteSlug(r.Circuit.circuitId, Number(r.round)),
    round: Number(r.round),
    season: Number(r.season),
    name: r.raceName,
    country: r.Circuit.Location.country,
    city: r.Circuit.Location.locality,
    circuitName: r.Circuit.circuitName,
    circuitId: r.Circuit.circuitId,
    date: r.date,
    raceStartIso: isoFromDateTime(r.date, r.time),
    sessions,
    wikiUrl: r.url,
    circuitWikiUrl: r.Circuit.url || undefined,
    lat: Number(r.Circuit.Location.lat),
    lon: Number(r.Circuit.Location.long),
  };
}

export interface UiDriver {
  id: string;
  slug: string;
  code: string;
  number: number | null;
  firstName: string;
  lastName: string;
  fullName: string;
  nationality: string;
  dob: string;
  wikiUrl: string;
}

export function mapDriver(d: JolpicaDriver): UiDriver {
  return {
    id: d.driverId,
    slug: d.driverId,
    code: d.code ?? d.familyName.slice(0, 3).toUpperCase(),
    number: d.permanentNumber ? Number(d.permanentNumber) : null,
    firstName: d.givenName,
    lastName: d.familyName,
    fullName: `${d.givenName} ${d.familyName}`,
    nationality: d.nationality ?? 'Unknown',
    dob: d.dateOfBirth ?? '',
    wikiUrl: d.url ?? '',
  };
}

export interface UiConstructor {
  id: string;
  slug: string;
  name: string;
  nationality: string;
  wikiUrl: string;
}

export function mapConstructor(c: JolpicaConstructor): UiConstructor {
  return {
    id: c.constructorId,
    slug: c.constructorId,
    name: c.name,
    nationality: c.nationality ?? 'Unknown',
    wikiUrl: c.url ?? '',
  };
}

/** Championship rank, or null when the provider published the row without one. */
function standingPosition(position: string | undefined): number | null {
  if (position === undefined || position === '') return null;
  const value = Number(position);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** What to print in a position column: the rank, "–" for an unranked row, or the provider's exclusion code. */
export function standingPositionLabel(standing: { position: number | null; positionText: string }): string {
  if (standing.position !== null) return String(standing.position);
  const text = standing.positionText.trim();
  return !text || text === '-' ? '–' : text;
}

/** Persistence keeps a not-null rank; unranked rows are display-only and are not stored as a fabricated position. */
export function isRankedStanding<T extends { position: number | null }>(standing: T): standing is T & { position: number } {
  return standing.position !== null;
}

export interface UiDriverStanding {
  /** null = not ranked in this championship (e.g. scored no points under the era's rules). */
  position: number | null;
  positionText: string;
  points: number;
  wins: number;
  driver: UiDriver;
  /** The team of the driver's latest race entry in this championship. */
  constructorName: string;
  constructorSlug: string;
  /**
   * Every team the driver drove for in this championship, the current team
   * last. Jolpica lists them in first-appearance order; the client's standings
   * read reorders multi-team rows from race entries (team-stints.ts), because a
   * driver can return to his first team (Lawson 2026: RB, Red Bull, then RB).
   */
  constructors: Array<{ name: string; slug: string }>;
}

export function mapDriverStanding(s: JolpicaDriverStandingEntry): UiDriverStanding {
  const constructors = (s.Constructors ?? []).map((team) => ({ name: team.name, slug: team.constructorId }));
  const current = constructors.at(-1);
  return {
    position: standingPosition(s.position),
    positionText: s.positionText,
    points: Number(s.points),
    wins: Number(s.wins),
    driver: mapDriver(s.Driver),
    constructorName: current?.name ?? '',
    constructorSlug: current?.slug ?? '',
    constructors,
  };
}

export interface UiConstructorStanding {
  /** null = not ranked in this championship. */
  position: number | null;
  positionText: string;
  points: number;
  wins: number;
  constructor: UiConstructor;
}

export function mapConstructorStanding(s: JolpicaConstructorStandingEntry): UiConstructorStanding {
  return {
    position: standingPosition(s.position),
    positionText: s.positionText,
    points: Number(s.points),
    wins: Number(s.wins),
    constructor: mapConstructor(s.Constructor),
  };
}

export interface UiResult {
  position: number;
  positionText: string;
  driver: UiDriver;
  constructor: UiConstructor | null;
  points: number;
  grid: number | null;
  laps: number | null;
  status: string;
  time?: string;
  fastestLap?: { rank: number; lap: number; time: string };
}

export function mapResult(r: JolpicaResultEntry): UiResult {
  return {
    position: Number(r.position),
    positionText: r.positionText,
    driver: mapDriver(r.Driver),
    constructor: r.Constructor ? mapConstructor(r.Constructor) : null,
    points: Number(r.points),
    grid: r.grid != null && Number.isFinite(Number(r.grid)) ? Number(r.grid) : null,
    laps: r.laps != null && Number.isFinite(Number(r.laps)) ? Number(r.laps) : null,
    status: r.status ?? 'Unknown',
    // Jolpica sends Time.time "" for some classified-but-retired rows; an empty
    // string is not a time, so the status (e.g. "Retired") must show instead.
    time: r.Time?.time?.trim() || undefined,
    fastestLap: r.FastestLap
      ? { rank: Number(r.FastestLap.rank), lap: Number(r.FastestLap.lap), time: r.FastestLap.Time.time }
      : undefined,
  };
}

/**
 * Parse an F1 time string to whole milliseconds.
 * Accepts "H:MM:SS.mmm", "M:SS.mmm", or "SS.mmm". Returns null if blank/unparseable.
 */
export function timeStringToMs(t?: string | null): number | null {
  if (!t) return null;
  const s = t.trim();
  if (!s) return null;
  const parts = s.split(':').map((p) => Number(p));
  if (parts.length > 3 || s.split(':').some(p => p.trim() === '') || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length > 1 && parts.slice(1).some(n => n >= 60)) return null;
  let seconds: number;
  if (parts.length === 3) seconds = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  else if (parts.length === 2) seconds = parts[0]! * 60 + parts[1]!;
  else seconds = parts[0]!;
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export interface UiQualifying {
  driverSlug: string;
  position: number | null;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
}

export function mapQualifying(q: JolpicaQualifyingEntry): UiQualifying {
  return {
    driverSlug: q.Driver.driverId,
    position: q.position ? Number(q.position) : null,
    q1Ms: timeStringToMs(q.Q1),
    q2Ms: timeStringToMs(q.Q2),
    q3Ms: timeStringToMs(q.Q3),
  };
}

export interface UiSprintResult {
  driverSlug: string;
  position: number | null;
  points: number;
  timeMs: number | null;
  status: string;
}

export function mapSprintResult(r: JolpicaResultEntry): UiSprintResult {
  return {
    driverSlug: r.Driver.driverId,
    position: r.position ? Number(r.position) : null,
    points: Number(r.points) || 0,
    timeMs: r.Time?.millis ? Number(r.Time.millis) : timeStringToMs(r.Time?.time),
    status: r.status ?? 'Unknown',
  };
}

export interface UiPitStop {
  driverSlug: string;
  lap: number;
  timeOfDay: string | null;
  durationMs: number | null;
}

export function mapPitStop(p: JolpicaPitStopEntry): UiPitStop {
  // duration is reported in seconds ("22.115"); store whole ms.
  const dur = p.duration ? Number(p.duration) : NaN;
  return {
    driverSlug: p.driverId,
    lap: Number(p.lap),
    timeOfDay: p.time || null,
    durationMs: Number.isFinite(dur) ? Math.round(dur * 1000) : null,
  };
}

export interface UiLap {
  driverSlug: string;
  lapNumber: number;
  position: number | null;
  timeMs: number | null;
}

export function mapLap(lapNumber: number, t: JolpicaLapTiming): UiLap {
  return {
    driverSlug: t.driverId,
    lapNumber,
    position: t.position ? Number(t.position) : null,
    timeMs: timeStringToMs(t.time),
  };
}
