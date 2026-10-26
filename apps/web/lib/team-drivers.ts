import { cache } from 'react';
import { jolpica, type TeamStint } from '@apex/api-client/jolpica';
import type { GridDriver } from './grid';

/**
 * Who raced for a team this season, and what they scored for it (R3-DATA-1).
 *
 * A driver who raced for one team scored all of his championship points for
 * it. A driver who raced for more than one (Lawson 2026: RB, Red Bull, RB)
 * appears under each team with the points he scored for that team, summed from
 * his own race and sprint results. When those results can't be read, his
 * points for the team are unknown (null) rather than his championship total.
 */
export interface TeamDriver {
  driver: GridDriver;
  /** Points scored for this team; null when the split is unavailable. */
  points: number | null;
  /** True when this is the driver's current team (his latest race entry). */
  current: boolean;
  /** True when the driver also raced for another team this season. */
  shared: boolean;
}

export function driversForTeam(teamSlug: string, grid: readonly GridDriver[], stints: ReadonlyMap<string, readonly TeamStint[] | null>): TeamDriver[] {
  return grid
    .filter((d) => d.teams.some((t) => t.slug === teamSlug) || d.teamSlug === teamSlug)
    .map((driver) => {
      const shared = driver.teams.length > 1;
      if (!shared) return { driver, points: driver.points, current: true, shared };
      const split = stints.get(driver.slug);
      const stint = split?.find((s) => s.constructorId === teamSlug);
      return { driver, points: split && split.length ? (stint?.points ?? 0) : null, current: driver.teamSlug === teamSlug, shared };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.points ?? -1) - (a.points ?? -1));
}

const stintsFor = cache(async (slug: string, season: number): Promise<TeamStint[] | null> => {
  const stints = await jolpica.getDriverTeamStints(slug, season, { revalidate: 3600, timeoutMs: 6_000, deadlineMs: 20_000 });
  return stints.length ? stints : null;
});

/** Per-team splits for every driver who raced for more than one team (two small reads each). */
export async function loadTeamSplits(season: number | null, grid: readonly GridDriver[]): Promise<Map<string, TeamStint[] | null>> {
  const out = new Map<string, TeamStint[] | null>();
  if (season === null) return out;
  await Promise.all(grid.filter((d) => d.teams.length > 1).map(async (d) => { out.set(d.slug, await stintsFor(d.slug, season).catch(() => null)); }));
  return out;
}
