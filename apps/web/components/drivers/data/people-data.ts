import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { openf1 } from '@apex/api-client/openf1';
import { getDriverStandings, getGrid, getStandingsSeason, getTeamColours, type GridDriver } from '@/lib/grid';
import { NEUTRAL_TEAM_COLOUR, normaliseTeamColour, teamColoursFromTiming, type TeamColours } from '@/lib/team-colours';
import { teamColorBySlug } from '@/lib/format';
import { mapResult } from '@apex/api-client/jolpica';
import type { RaceRows } from '../people';
import { lastGoodColours } from './colour-snapshot';

/**
 * Page-level data joins for the People pages.
 *
 * Team colours come from OpenF1 `team_colour` (lib/grid getTeamColours). That
 * join reads only OpenF1's "latest" session, which is empty whenever the next
 * session is published but has not started yet (e.g. the days before a race
 * weekend's first practice). Here the colours fall back to the newest session
 * of the same season that has already finished: the same provider and field,
 * never a hard-coded livery. If both are empty the neutral colour stays.
 *
 * OpenF1 refuses every unauthenticated request (even historical ones) while
 * any F1 session is live. So the last good answer is persisted: a committed
 * snapshot of OpenF1 `team_colour` for the season (team-colour-snapshot.json,
 * with its session key and end time) is the final fallback, used only for the
 * season it describes. A failed read is never cached as "no colours".
 *
 * Follow-up for the data owner: move this fallback into lib/grid-timing with
 * a durable store refreshed after each session (see designer-4 report).
 */

const finishedSessionColours = unstable_cache(
  async (season: number, standings: Array<{ constructorSlug: string; code: string }>): Promise<Record<string, string>> => {
    // Errors propagate: unstable_cache stores only successful reads, so an OpenF1
    // refusal during a live session is retried later instead of cached as empty.
    const sessions = await openf1.getSessionsForYear(season, { strict: true, revalidate: 3600 });
    const now = Date.now();
    const finished = sessions
      .filter((s) => s.is_cancelled !== true && Number.isFinite(Date.parse(s.date_end ?? '')) && Date.parse(s.date_end!) < now)
      .sort((a, b) => Date.parse(b.date_end!) - Date.parse(a.date_end!));
    for (const session of finished.slice(0, 3)) {
      const drivers = await openf1.getDrivers(session.session_key, { strict: true, revalidate: 3600 });
      const map = teamColoursFromTiming(standings, drivers.filter((d) => d.session_key === session.session_key));
      if (Object.keys(map).length) return { ...map };
    }
    return {};
  },
  ['apex-people-finished-session-colours-v2'],
  { revalidate: 3600 },
);

export const getPeopleColours = cache(async (): Promise<TeamColours> => {
  const live = await getTeamColours();
  if (Object.keys(live).length) return live;
  const [table, standings] = await Promise.all([getStandingsSeason(), getDriverStandings()]);
  if (table.season === null || table.season < 2023) return live;
  const rows = standings.map((s) => ({ constructorSlug: s.constructorSlug, code: s.driver.code }));
  try {
    const finished = await finishedSessionColours(table.season, rows);
    if (Object.keys(finished).length) return Object.freeze(finished);
  } catch {
    /* OpenF1 refused or failed (e.g. a session is live): use the persisted snapshot */
  }
  return lastGoodColours(table.season, rows);
});

/**
 * Colour lookup for a career sheet. Team colours are this season's OpenF1
 * liveries, so they colour only rows of the season they come from; earlier
 * seasons stay neutral rather than wearing today's paint (McLaren's 2010 car
 * was not papaya).
 */
export function liveryFor(colours: TeamColours, season: number | null): (teamSlug: string, year: number) => string {
  return (teamSlug, year) => (season !== null && year === season ? teamColorBySlug(teamSlug, colours) : NEUTRAL_TEAM_COLOUR);
}

/** Team colour for a constructor id, from live timing or the newest finished session. */
export async function peopleColourOf(slug: string | null | undefined): Promise<string> {
  return teamColorBySlug(slug, await getPeopleColours());
}

/** The current grid with team colours filled from the finished-session fallback when timing has none. */
export const getPeopleGrid = cache(async (): Promise<GridDriver[]> => {
  const [grid, colours] = await Promise.all([getGrid(), getPeopleColours()]);
  return grid.map((d) => {
    const own = normaliseTeamColour(d.color);
    if (own && own !== NEUTRAL_TEAM_COLOUR.toUpperCase()) return d;
    return { ...d, color: teamColorBySlug(d.teamSlug, colours) };
  });
});

type ProviderRace = {
  season: string;
  round: string;
  raceName: string;
  Circuit: { Location: { country: string } };
  Results?: Parameters<typeof mapResult>[0][];
};

/** Jolpica result races -> the pure RaceRows shape used by components/drivers/people.ts. */
export function toRaceRows(races: readonly ProviderRace[]): RaceRows[] {
  return races.map((race) => ({
    season: Number(race.season),
    round: Number(race.round),
    raceName: race.raceName,
    country: race.Circuit?.Location?.country ?? '',
    rows: (race.Results ?? []).map((entry) => {
      const r = mapResult(entry);
      return {
        position: Number.isFinite(r.position) ? r.position : null,
        positionText: r.positionText,
        points: Number.isFinite(r.points) ? r.points : 0,
        grid: r.grid,
        laps: r.laps,
        status: r.status,
        fastestLap: r.fastestLap ? { rank: r.fastestLap.rank } : undefined,
        driver: { slug: r.driver.slug, fullName: r.driver.fullName, firstName: r.driver.firstName, lastName: r.driver.lastName, code: r.driver.code },
        constructor: r.constructor ? { slug: r.constructor.slug, name: r.constructor.name } : null,
      };
    }),
  }));
}
