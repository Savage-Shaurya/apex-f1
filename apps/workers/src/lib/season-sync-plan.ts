import {
  PREVIOUS_SEASON_SYNC_WINDOW_MS,
  completedSeasonFloor,
  isSeasonFinished,
  jolpica,
  mapRace,
  selectSyncSeasons,
  type FetchOpts,
  type UiRace,
} from '@apex/api-client/jolpica';
import type { JobContext } from './job-control';
import { isProviderUnavailable } from '@apex/api-client/jolpica';
import { budgetSpent, currentSeasonOperations, jobReadOptions, synchronizeCurrentSeason } from './current-season-sync';

/**
 * Which seasons the nightly Jolpica sync refreshes, decided from the real
 * calendar rather than the clock year (rules: @apex/api-client/jolpica season.ts).
 *
 *  - Active season: the `current` calendar, or the next season once `current`
 *    has finished and the next calendar is published.
 *  - Previous season: also synced until 30 days after its final race, so late
 *    penalties and classification corrections land.
 *  - If `current` has no published races (Jolpica rolled to a new year before
 *    its calendar exists), the latest season with a calendar stays active.
 *    An empty calendar is never synced, so the job does not fail nightly.
 */
export interface SeasonSyncPlan {
  seasons: number[];
  active: number;
  /** The season Jolpica's `current` alias denotes, when it has races. */
  currentAlias: number | null;
  /** Seasons whose final race has run (their champions can change on correction). */
  finished: number[];
  /**
   * Non-fatal planning notes (an optional neighbouring calendar could not be
   * read). The plan still syncs every season it confirmed, so these are
   * warnings, never a failed job.
   */
  warnings: string[];
}

/**
 * The previous season's finale always precedes the current season's first
 * race, so once that first race is more than the correction window in the
 * past, the previous season's window is certainly closed and its calendar
 * need not be read at all.
 */
export function previousSeasonWindowMayBeOpen(current: readonly UiRace[], now: number): boolean {
  const starts = current.map((race) => Date.parse(race.raceStartIso)).filter(Number.isFinite);
  if (!starts.length) return true;
  return now < Math.min(...starts) + PREVIOUS_SEASON_SYNC_WINDOW_MS;
}

type ScheduleReader = Pick<typeof jolpica, 'getSchedule'>['getSchedule'];

export async function planSeasonSync(now: number, options: () => FetchOpts, schedule: ScheduleReader = jolpica.getSchedule): Promise<SeasonSyncPlan> {
  const read = async (season: number | 'current'): Promise<UiRace[]> =>
    (await schedule(season, options())).map(mapRace).sort((a, b) => a.round - b.round);
  const warnings: string[] = [];
  const current = await read('current');
  let active: { season: number; races: UiRace[] };
  let previous: { season: number; races: UiRace[] } | null = null;
  let currentAlias: number | null = null;
  if (current.length) {
    const season = current[0]!.season;
    currentAlias = season;
    if (isSeasonFinished(current, now)) {
      let next: UiRace[] = [];
      try { next = await read(season + 1); }
      catch { warnings.push(`calendar ${season + 1}: next-season calendar could not be read; ${season} stays active.`); }
      if (next.length) { active = { season: season + 1, races: next }; previous = { season, races: current }; }
      else active = { season, races: current };
    } else {
      active = { season, races: current };
      // Read the previous calendar only while its correction window can still be open.
      if (previousSeasonWindowMayBeOpen(current, now)) {
        try { previous = { season: season - 1, races: await read(season - 1) }; }
        catch { warnings.push(`calendar ${season - 1}: previous-season calendar could not be read; its correction window was not checked.`); }
      }
    }
  } else {
    // `current` exists but has no races: keep the last season with a calendar.
    const floor = completedSeasonFloor(now);
    const races = await read(floor);
    if (!races.length) throw new Error('calendar: incomplete empty current calendar; no season to synchronize.');
    active = { season: floor, races };
  }
  const seasons = selectSyncSeasons({ now, active, previous });
  const finished = [active, previous].flatMap((entry) => entry && seasons.includes(entry.season) && isSeasonFinished(entry.races, now) ? [entry.season] : []);
  return { seasons, active: active.season, currentAlias, finished, warnings };
}

export interface ActiveSeasonsReport {
  ok: boolean;
  complete: boolean;
  seasons: number[];
  counts: Record<string, number>;
  bySeason: Record<string, Record<string, number>>;
  errors: string[];
  /** Optional planning reads that failed; reported, but they do not fail the job. */
  warnings: string[];
  /** Every error was caused only by the provider being unavailable (timeouts, 429, 5xx, edge errors): retry later. */
  providerUnavailable: boolean;
}

/**
 * Plan, then synchronise each selected season in order. `beforeSeason` runs
 * ahead of each season's sync (cache invalidation); `afterSeason` after it
 * (path revalidation). Counts are summed; errors carry their season.
 */
export async function synchronizeActiveSeasons(job: JobContext, input: {
  now?: number;
  maximumRounds?: number;
  operations?: typeof currentSeasonOperations;
  schedule?: ScheduleReader;
  beforeSeason?: (season: number, plan: SeasonSyncPlan) => Promise<void> | void;
  afterSeason?: (season: number, plan: SeasonSyncPlan) => Promise<void> | void;
} = {}): Promise<ActiveSeasonsReport> {
  const operations = input.operations ?? currentSeasonOperations;
  let plan: SeasonSyncPlan;
  try {
    plan = await planSeasonSync(input.now ?? Date.now(), () => jobReadOptions(job), input.schedule ?? operations.schedule);
  } catch (error) {
    if (budgetSpent(job)) return { ok: true, complete: false, seasons: [], counts: { budget_exhausted: 1 }, bySeason: {}, errors: [], warnings: ['calendar: the time budget ran out before the season plan was read; the next run continues.'], providerUnavailable: false };
    job.assertActive();
    const message = error instanceof Error && /incomplete|calendar/i.test(error.message) ? error.message.slice(0, 200) : 'calendar: season plan could not be read; previous verified data was retained.';
    return { ok: false, complete: false, seasons: [], counts: {}, bySeason: {}, errors: [message], warnings: [], providerUnavailable: isProviderUnavailable(error) };
  }
  const counts: Record<string, number> = {};
  const bySeason: Record<string, Record<string, number>> = {};
  const errors: string[] = [];
  // A skipped optional read leaves the run incomplete (reported) but not failed.
  let complete = plan.warnings.length === 0;
  for (const [index, season] of plan.seasons.entries()) {
    if (budgetSpent(job)) {
      // Out of time between seasons: the rest is deferred, not failed.
      counts.seasons_deferred = plan.seasons.length - index;
      counts.budget_exhausted = 1;
      complete = false;
      break;
    }
    await input.beforeSeason?.(season, plan);
    const result = await synchronizeCurrentSeason(season, job, operations, input.maximumRounds ?? 4);
    bySeason[season] = result.counts;
    for (const [key, value] of Object.entries(result.counts)) counts[key] = (counts[key] ?? 0) + value;
    errors.push(...result.errors.map((message) => `${season} ${message}`));
    complete &&= result.complete;
    await input.afterSeason?.(season, plan);
    if (result.counts.budget_exhausted) {
      counts.seasons_deferred = plan.seasons.length - index - 1;
      complete = false;
      break;
    }
  }
  const providerUnavailable = errors.length > 0 && (counts.provider_unavailable_errors ?? 0) === errors.length;
  return { ok: errors.length === 0, complete: complete && errors.length === 0, seasons: plan.seasons, counts, bySeason, errors, warnings: plan.warnings, providerUnavailable };
}
