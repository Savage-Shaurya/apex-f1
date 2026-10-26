import { jolpica } from '@apex/api-client/jolpica';
import { prebuildable, readCurrentStandings, readPublicSport, retryUnavailable, SPORT_READ_OPTIONS, type RetryOptions } from '@/lib/public-sport';
import { getSeasonContext } from '@/lib/season';

/** Pure range check: 1950 to the newest season with live standings. */
export function parseResultsSeason(raw: string, newest: number): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const season = Number(raw);
  return season >= 1950 && season <= newest ? season : null;
}

/**
 * Newest season a /results URL may name. Normally the season whose standings
 * are live. When no provider read confirmed it (Jolpica outage), resultsSeason
 * is only the safe floor (last calendar year), so the current calendar year is
 * still accepted: its page renders the unavailable state instead of a 404 that
 * would tell visitors and crawlers the season does not exist (R3-REG-1).
 */
export function newestResultsSeason(context: { resultsSeason: number; resultsSeasonConfirmed: boolean; now: number }): number {
  return context.resultsSeasonConfirmed ? context.resultsSeason : Math.max(context.resultsSeason, new Date(context.now).getUTCFullYear());
}

/** 1950 to the season whose standings are live (lib/season.ts), never the clock year while it is confirmed. */
export async function resolveResultsSeason(raw: string): Promise<{ season: number; newest: number } | null> {
  const newest = newestResultsSeason(await getSeasonContext());
  const season = parseResultsSeason(raw, newest);
  return season === null ? null : { season, newest };
}


type SeasonRead = () => Promise<{ state: 'available' | 'unavailable'; snapshot: { season: string | null } | null }>;

/**
 * Outage policy: the current season's tables are prebuilt, so they always
 * have a good cached copy that ISR keeps serving through a provider outage.
 * The season comes from the live standings (bounded retry); if it cannot be
 * read at build time nothing is prebuilt and the pages render on first visit.
 */
export async function currentResultsSeasonParams(read: SeasonRead = () => readCurrentStandings(jolpica.getDriverStandingsSnapshot), retry: RetryOptions = {}, probe: (param: { season: string }) => Promise<boolean> = async () => true): Promise<Array<{ season: string }>> {
  try {
    const table = await retryUnavailable(read, retry);
    const season = table.state === 'available' ? Number(table.snapshot?.season) : NaN;
    // The table itself must answer too, else the path renders on first visit instead of failing the build (F-01).
    return Number.isInteger(season) && season >= 1950 ? await prebuildable([{ season: String(season) }], probe) : [];
  } catch {
    return [];
  }
}

/**
 * The exact read StandingsView makes for this table (same request, so the
 * page reuses it from the per-build store), answering now.
 */
export function standingsTableAnswers(kind: 'drivers' | 'teams') {
  return async ({ season }: { season: string }): Promise<boolean> => {
    const opts = { ...SPORT_READ_OPTIONS, revalidate: 300 };
    const read = await readPublicSport<{ standings: unknown[] }>(() => (kind === 'drivers' ? jolpica.getDriverStandingsSnapshot(Number(season), opts) : jolpica.getConstructorStandingsSnapshot(Number(season), opts)));
    return read.state === 'available';
  };
}
