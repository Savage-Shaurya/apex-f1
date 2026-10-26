import { completedSeasonFloor, jolpica, mapRace, type FetchOpts, type JolpicaRace, type UiRace } from '@apex/api-client/jolpica';
import { ProviderError, withProviderDeadline } from '../../../packages/api-client/src/transport';
import { calendarFocusIndex } from './calendar-window';
import { BUILD_QUEUE_ALLOWANCE_MS, isBuildPhase } from '../../../packages/api-client/src/build-phase';

/**
 * Render reads: 6 s per provider transport, 20 s for a whole multi-request
 * read. During `next build` the client also lets each read queue for
 * BUILD_QUEUE_ALLOWANCE_MS (F-01), so multi-request deadlines grow by the same
 * allowance there; a visitor's render keeps the short budget.
 */
export const SPORT_READ_OPTIONS = { strict: true, timeoutMs: 6_000, deadlineMs: 20_000 + (isBuildPhase() ? BUILD_QUEUE_ALLOWANCE_MS : 0) } as const;
/**
 * Why a read is unavailable, so a page can say what is actually wrong:
 *  - configuration: the server is missing required setup (not the provider's fault);
 *  - live-session: OpenF1 is closed to free users while a session is live;
 *  - rate-limit: the hourly request budget is used up;
 *  - provider: the provider failed, timed out or sent bad data.
 */
export type UnavailableReason = 'configuration' | 'live-session' | 'rate-limit' | 'provider';
export type PublicRead<T> = { state: 'available'; data: T } | { state: 'unavailable'; reason?: UnavailableReason };
const unavailableCodes = new Set(['http', 'network', 'timeout', 'rate-limit', 'invalid-response', 'incomplete', 'configuration']);

export function unavailableReason(error: unknown): UnavailableReason {
  if (!(error instanceof ProviderError)) return 'provider';
  if (error.code === 'configuration') return 'configuration';
  if (error.name === 'OpenF1LiveSessionLockout') return 'live-session';
  if (error.code === 'rate-limit' || (error.code === 'http' && error.status === 429)) return 'rate-limit';
  return 'provider';
}

/** Expected transport failures are data states. Programming errors still reach the error boundary. */
export function isSportUnavailable(error: unknown): boolean {
  return error instanceof ProviderError && ((error.provider === 'jolpica' || error.provider === 'openf1') && unavailableCodes.has(error.code) || error.provider === 'response' && (error.code === 'invalid-response' || error.code === 'timeout'));
}

export async function readPublicSport<T>(operation: () => Promise<T>): Promise<PublicRead<T>> {
  try { return { state: 'available', data: await operation() }; }
  catch (error) { if (!isSportUnavailable(error)) throw error; return { state: 'unavailable', reason: unavailableReason(error) }; }
}

export interface RetryOptions { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> }
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Bounded retry for reads that decide what `next build` prebuilds (an outage
 * there must not silently drop pages: red_bull/rb were skipped once by a single
 * transient failure). Up to `attempts` tries, waiting delayMs x try between
 * them; returns the first available result, else the last unavailable one.
 * Thrown errors count as unavailable tries and are rethrown only at the end.
 */
export async function retryUnavailable<T extends { state: string }>(read: () => Promise<T>, { attempts = 3, delayMs = 1_500, sleep = realSleep }: RetryOptions = {}): Promise<T> {
  let last: T | undefined;
  let error: unknown;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    if (i > 0) await sleep(delayMs * i);
    try {
      last = await read();
      error = undefined;
      if (last.state !== 'unavailable') return last;
    } catch (e) { error = e; }
  }
  if (error !== undefined && last === undefined) throw error;
  return last!;
}

/** True while `next build` prerenders: provider reads there get the bounded retry above. */
export const duringBuild = () => isBuildPhase();

type IdentityProvider = Pick<typeof jolpica, 'getDriver' | 'getConstructor'>;
const validSlug = /^[a-zA-Z0-9_-]{1,160}$/;
export async function readDriverIdentity(id: string, provider: IdentityProvider = jolpica, retry: RetryOptions = { attempts: duringBuild() ? 3 : 1 }) {
  if (!validSlug.test(id)) return { state: 'missing' as const };
  const read = await retryUnavailable(() => readPublicSport(() => provider.getDriver(id, { ...SPORT_READ_OPTIONS, revalidate: 86_400 })), retry);
  if (read.state === 'unavailable') return read;
  return read.data ? { state: 'found' as const, raw: read.data } : { state: 'missing' as const };
}
export async function readConstructorIdentity(id: string, provider: IdentityProvider = jolpica, retry: RetryOptions = { attempts: duringBuild() ? 3 : 1 }) {
  if (!validSlug.test(id)) return { state: 'missing' as const };
  const read = await retryUnavailable(() => readPublicSport(() => provider.getConstructor(id, { ...SPORT_READ_OPTIONS, revalidate: 86_400 })), retry);
  if (read.state === 'unavailable') return read;
  return read.data ? { state: 'found' as const, raw: read.data } : { state: 'missing' as const };
}

type WindowProvider = Pick<typeof jolpica, 'getConstructorResultsInSeason'>;
/** One whole-window deadline and at most three season requests in flight. No partial totals escape. */
export async function readConstructorWindow(id: string, years: number[], provider: WindowProvider = jolpica) {
  return readPublicSport(() => withProviderDeadline('jolpica', async signal => {
    const output = new Array<{ year: number; races: Awaited<ReturnType<WindowProvider['getConstructorResultsInSeason']>> }>(years.length);
    let next = 0;
    const expires = Date.now() + SPORT_READ_OPTIONS.deadlineMs;
      await Promise.all(Array.from({ length: Math.min(3, years.length) }, async () => {
        for (;;) {
          const index = next++;
          if (index >= years.length) return;
          if (signal.aborted) throw new ProviderError('jolpica', 'timeout');
          const year = years[index]!;
          const races = await provider.getConstructorResultsInSeason(id, year, { ...SPORT_READ_OPTIONS, deadlineMs: Math.max(1, expires - Date.now()), revalidate: 300, signal });
          output[index] = { year, races };
        }
      }));
      return output;
  }, { timeoutMs: SPORT_READ_OPTIONS.deadlineMs }));
}

type CalendarProvider = Pick<typeof jolpica, 'getSchedule'> & Partial<Pick<typeof jolpica, 'getScheduleSnapshot'>>;
export interface PublicCalendar {
  state: 'available' | 'unavailable'; races: UiRace[]; next: UiRace | null; previous: UiRace | null; now: number;
  /**
   * The calendar's season, from Jolpica. When nothing could be read (no races)
   * it is only the calendar-year upper bound for season pickers: the season
   * context drops it and no page may print it as the current season.
   */
  season: number;
}
/** Only confirmed end-of-season data may trigger a next-year lookup. */
export async function readCalendar(provider: CalendarProvider = jolpica, now = Date.now()): Promise<PublicCalendar> {
  // Only the documented safe floor comes from the clock (the season before
  // this calendar year has always finished). It labels nothing on an outage:
  // season context ignores an unavailable calendar with no races.
  const floor = completedSeasonFloor(now);
  const current = await readPublicSport(async (): Promise<{ season: number | null; races: JolpicaRace[] }> => provider.getScheduleSnapshot
    ? provider.getScheduleSnapshot('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 })
    : { season: null, races: await provider.getSchedule('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 }) });
  if (current.state === 'unavailable') return { state: 'unavailable', races: [], next: null, previous: null, now, season: floor };
  let races = current.data.races.map(mapRace).sort((a, b) => a.round - b.round);
  // The season Jolpica names for `current`, even before its first race is published.
  let season = races[0]?.season ?? current.data.season ?? floor + 1;
  let next = races[calendarFocusIndex(races, now)] ?? null;
  let previous = next ? races.filter(race => race.round < next!.round).at(-1) ?? null : races.at(-1) ?? null;
  if (!next) {
    const following = await readPublicSport(() => provider.getSchedule(season + 1, { ...SPORT_READ_OPTIONS, revalidate: 3600 }));
    if (following.state === 'unavailable') return { state: 'unavailable', races, next, previous, now, season };
    const future = following.data.map(mapRace).sort((a, b) => a.round - b.round);
    const candidate = future[calendarFocusIndex(future, now)] ?? null;
    if (candidate) { previous = races.at(-1) ?? null; races = future; season += 1; next = candidate; }
  }
  // Across the season boundary the current calendar has no earlier round (next is
  // round 1, or Jolpica's "current" already names a season with no races yet). The
  // last race is then the previous season's final round, read from its own calendar
  // (R3-TIME-2), so the home "Last race" and the champions count survive the winter.
  if (!previous && season > 1950) {
    const before = await readPublicSport(() => provider.getSchedule(season - 1, { ...SPORT_READ_OPTIONS, revalidate: 86_400 }));
    if (before.state === 'available') {
      const final = before.data.map(mapRace).filter(race => race.season === season - 1).sort((a, b) => a.round - b.round).at(-1) ?? null;
      const start = final ? Date.parse(final.raceStartIso) : NaN;
      if (final && Number.isFinite(start) && start <= now) previous = final;
    }
  }
  return { state: 'available', races, next, previous, now, season };
}

/**
 * The season before Jolpica's "current" one, read from the current calendar
 * (same cached request as the site calendar); only when that cannot be read
 * does the shared safe floor apply.
 */
async function previousSeasonFromCalendar(provider: CalendarProvider, now: number): Promise<number> {
  // The snapshot names the season even when its calendar has no race yet (an empty new season).
  const schedule = await readPublicSport(async (): Promise<{ season: number | null; races: JolpicaRace[] }> => provider.getScheduleSnapshot
    ? provider.getScheduleSnapshot('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 })
    : { season: null, races: await provider.getSchedule('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 }) });
  const season = schedule.state === 'available' ? Number(schedule.data.races[0]?.season ?? schedule.data.season) : NaN;
  return Number.isSafeInteger(season) && season > 1950 ? season - 1 : completedSeasonFloor(now);
}

export async function readCurrentStandings<T extends { season: string | null; round: number | null; standings: unknown[]; tableSeason?: number | null }>(read: (season: number | 'current', options: FetchOpts) => Promise<T>, now = Date.now(), calendar?: CalendarProvider) {
  const current = await readPublicSport(() => read('current', { ...SPORT_READ_OPTIONS, revalidate: 600 }));
  if (current.state === 'unavailable') return { state: 'unavailable' as const, snapshot: null, previousSeasonFinal: false };
  if (current.data.standings.length) return { state: 'available' as const, snapshot: current.data, previousSeasonFinal: false };
  // An empty "current" table is a new season with no classified round: show the
  // season before the one Jolpica declares: the table's own season, else the
  // current calendar's, and the clock floor only if neither is known.
  const previousSeason = current.data.tableSeason
    ? current.data.tableSeason - 1
    : calendar ? await previousSeasonFromCalendar(calendar, now) : completedSeasonFloor(now);
  const previous = await readPublicSport(() => read(previousSeason, { ...SPORT_READ_OPTIONS, revalidate: 86_400 }));
  if (previous.state === 'unavailable') return { state: 'unavailable' as const, snapshot: null, previousSeasonFinal: false };
  return { state: 'available' as const, snapshot: previous.data, previousSeasonFinal: previous.data.standings.length > 0 };
}

/** Strict mode is required on each public search source; an incomplete corpus cannot establish no matches. */
export async function readSearchCorpus(provider: typeof jolpica = jolpica) {
  return readPublicSport(() => withProviderDeadline('jolpica', signal => Promise.all([
    provider.getDriverStandings('current', { ...SPORT_READ_OPTIONS, signal, revalidate: 1800 }),
    provider.getConstructorStandings('current', { ...SPORT_READ_OPTIONS, signal, revalidate: 1800 }),
    provider.getSchedule('current', { ...SPORT_READ_OPTIONS, signal, revalidate: 3600 }),
    provider.getAllDrivers({ ...SPORT_READ_OPTIONS, signal, revalidate: 86_400 }),
    provider.getSeasons({ ...SPORT_READ_OPTIONS, signal, revalidate: 86_400 }),
    provider.getAllConstructors({ ...SPORT_READ_OPTIONS, signal, revalidate: 86_400 }),
  ]), { timeoutMs: SPORT_READ_OPTIONS.deadlineMs }));
}

/**
 * Prebuild only what can be built now (F-01): keeps the params whose critical
 * read answers during `next build` (the client already retried it inside its
 * build budget). A param whose read still fails is left out of the prebuild
 * and renders on its first visit (ISR, dynamicParams) instead of failing the
 * deploy. At most `concurrency` probes run at once; a probe that throws counts
 * as unavailable. The page then reads the same request from the per-build store.
 */
export async function prebuildable<P>(params: readonly P[], probe: (param: P) => Promise<boolean>, concurrency = 4): Promise<P[]> {
  const keep = new Array<boolean>(params.length).fill(false);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), params.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= params.length) return;
      keep[index] = await probe(params[index]!).catch(() => false);
    }
  }));
  const skipped = params.filter((_, index) => !keep[index]);
  if (skipped.length && duringBuild()) console.warn(`[apex] build: ${skipped.length} of ${params.length} paths left out of the prebuild (provider unavailable); they render on first visit.`);
  return params.filter((_, index) => keep[index]);
}
