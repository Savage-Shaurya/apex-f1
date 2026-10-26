/**
 * Season source of truth: pure rules, shared by the web app and the workers.
 *
 * Nothing here reads the clock. Callers pass `now` (milliseconds) together
 * with real Jolpica calendar and standings facts, so every rule is testable
 * at any date, including the New Year rollover.
 *
 * The only clock-derived value is the safe floor `utcYear(now) - 1`: Formula 1
 * seasons always finish inside their own calendar year, so the season before
 * the current calendar year is complete on any date. It is a lower bound used
 * when the provider cannot confirm anything newer, never a guess at the
 * current season.
 */

/** Same margin as the calendar focus window: a race is over 3 h after its start. */
export const SEASON_FINISH_GRACE_MS = 3 * 3_600_000;
/** A finished season keeps being re-synced for corrections until this long after its final race. */
export const PREVIOUS_SEASON_SYNC_WINDOW_MS = 30 * 86_400_000;

export interface SeasonRace {
  round: number;
  raceStartIso: string;
}

export interface SeasonCalendarFacts {
  season: number;
  races: readonly SeasonRace[];
  /** The last race before the calendar focus. When the calendar has rolled
   * forward to a new season, this is the previous season's final race. */
  previous?: (SeasonRace & { season: number }) | null;
}

export interface SeasonStandingsFacts {
  season: number | null;
  round: number | null;
}

export function utcYear(now: number): number {
  return new Date(now).getUTCFullYear();
}

/** The season before the current calendar year, which has always finished. */
export function completedSeasonFloor(now: number): number {
  return utcYear(now) - 1;
}

/** Highest round and its start time, or null when nothing usable is published. */
export function finalRace(races: readonly SeasonRace[]): { round: number; startMs: number } | null {
  let final: { round: number; startMs: number } | null = null;
  for (const race of races) {
    const startMs = Date.parse(race.raceStartIso);
    if (!Number.isSafeInteger(race.round) || !Number.isFinite(startMs)) continue;
    if (!final || race.round > final.round) final = { round: race.round, startMs };
  }
  return final;
}

/** True once the final round's race has run. An empty calendar never counts as finished. */
export function isSeasonFinished(races: readonly SeasonRace[], now: number): boolean {
  const final = finalRace(races);
  return final !== null && Number.isFinite(now) && final.startMs + SEASON_FINISH_GRACE_MS <= now;
}

export function hasStartedRace(races: readonly SeasonRace[], now: number): boolean {
  return races.some((race) => {
    const start = Date.parse(race.raceStartIso);
    return Number.isFinite(start) && start + SEASON_FINISH_GRACE_MS <= now;
  });
}

/**
 * The last season whose final round is in the past and classified.
 *
 * A season counts only when its final race has run and Jolpica's standings
 * already include that round (or have moved on to a later season). Until then
 * the previous season is returned, so a champion is never read from a table
 * that is missing the deciding race.
 */
export function resolveLastCompletedSeason(input: {
  now: number;
  calendar: SeasonCalendarFacts | null;
  standings: SeasonStandingsFacts | null;
}): number {
  const floor = completedSeasonFloor(input.now);
  const calendar = input.calendar;
  if (!calendar || !Number.isSafeInteger(calendar.season)) return floor;
  let candidate: number;
  let finalRound: number | null = null;
  if (!calendar.races.length) {
    // A new season with no calendar yet: the season before it is the candidate when
    // its final race is known (R3-TIME-2: Jolpica rolls "current" before 1 January).
    if (!calendar.previous || calendar.previous.season !== calendar.season - 1) return floor;
    candidate = calendar.previous.season;
    finalRound = calendar.previous.round;
  } else if (isSeasonFinished(calendar.races, input.now)) {
    candidate = calendar.season;
    finalRound = finalRace(calendar.races)!.round;
  } else {
    candidate = calendar.season - 1;
    if (calendar.previous && calendar.previous.season === candidate) finalRound = calendar.previous.round;
  }
  if (candidate <= floor) return floor;
  const standings = input.standings;
  const confirmed = Boolean(standings && standings.season !== null && (
    standings.season > candidate
    || (standings.season === candidate && finalRound !== null && standings.round !== null && standings.round >= finalRound)
  ));
  return Math.max(confirmed ? candidate : candidate - 1, floor);
}

export interface SeasonContextFacts {
  now: number;
  /** The season /schedule shows; null when the calendar could not be read. */
  calendarSeason: number | null;
  /** The season the site is about: the calendar season when it has races, otherwise the latest standings season. */
  activeSeason: number;
  /** The season whose standings tables are live (results links, rosters, team windows). */
  resultsSeason: number;
  /** The newest season with a confirmed final classification (champions "through"). */
  lastCompletedSeason: number;
  /**
   * False when neither the calendar nor the standings could be read, so
   * `resultsSeason` / `activeSeason` are only the safe clock floor (last
   * calendar year). Links and labels should then point to the results archive
   * rather than print a guessed season.
   */
  resultsSeasonConfirmed: boolean;
}

/** Combine the calendar and standings reads into one consistent set of season labels. */
export function resolveSeasonContext(input: {
  now: number;
  calendar: SeasonCalendarFacts | null;
  standings: SeasonStandingsFacts | null;
}): SeasonContextFacts {
  const lastCompletedSeason = resolveLastCompletedSeason(input);
  const calendar = input.calendar;
  const calendarHasRaces = Boolean(calendar && calendar.races.length);
  const resultsSeason = input.standings?.season
    ?? (calendar && calendarHasRaces && hasStartedRace(calendar.races, input.now) ? calendar.season : lastCompletedSeason);
  const resultsSeasonConfirmed = input.standings?.season != null || Boolean(calendar && calendarHasRaces);
  return {
    now: input.now,
    calendarSeason: calendar ? calendar.season : null,
    activeSeason: calendar && calendarHasRaces ? calendar.season : resultsSeason,
    resultsSeason,
    lastCompletedSeason,
    resultsSeasonConfirmed,
  };
}

/**
 * Seasons the nightly sync should refresh: the active season, plus the
 * previous season until 30 days after its final race (late penalties and
 * classification corrections). The previous season comes first, because in
 * that window the active season has no classified race yet.
 */
export function selectSyncSeasons(input: {
  now: number;
  active: { season: number; races: readonly SeasonRace[] };
  previous: { season: number; races: readonly SeasonRace[] } | null;
}): number[] {
  const seasons: number[] = [];
  const previous = input.previous;
  if (previous && previous.season < input.active.season) {
    const final = finalRace(previous.races);
    if (final && input.now < final.startMs + PREVIOUS_SEASON_SYNC_WINDOW_MS) seasons.push(previous.season);
  }
  seasons.push(input.active.season);
  return seasons;
}

/** Whole years between a date of birth (YYYY-MM-DD) and `now`, by calendar date. */
export function ageOn(dob: string, now: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!match || !Number.isFinite(now)) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const today = new Date(now);
  let age = today.getUTCFullYear() - year;
  const beforeBirthday = today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day);
  if (beforeBirthday) age--;
  return age >= 0 && age < 130 ? age : null;
}
