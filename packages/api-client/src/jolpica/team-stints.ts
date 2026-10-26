/**
 * A driver's teams within one season, worked out from race entries.
 *
 * Jolpica's driver standings list a driver's Constructors in the order the
 * driver first drove for them, not by the most recent drive. A driver who
 * goes back to his first team mid-season (Lawson 2026: RB for rounds 1-11,
 * Red Bull for 12-14, RB again for 15-18) is listed [rb, red_bull], so "the
 * last listed team" names the wrong current team. The truth is the team of
 * the driver's latest race entry (highest round).
 */

interface StintRow {
  points?: string;
  Driver?: { driverId?: string };
  Constructor?: { constructorId?: string; name?: string };
}
interface StintRace {
  round: string;
  Results?: StintRow[];
  SprintResults?: StintRow[];
}

export interface TeamStint {
  constructorId: string;
  name: string;
  /** First and latest Grand Prix round entered for this team. */
  firstRound: number;
  lastRound: number;
  /** Grand Prix entries for this team (race rows; sprints are not counted). */
  races: number;
  /** Points scored for this team: Grand Prix plus sprint points. */
  points: number;
}

const roundOf = (race: StintRace) => Number(race.round);
const pointsOf = (row: StintRow) => {
  const value = Number(row.points ?? 0);
  return Number.isFinite(value) ? value : 0;
};

/**
 * One stint per team the driver entered, ordered by the latest round entered
 * (the current team last). Rounds after `throughRound` are ignored, so a
 * standings table filed at round N is matched with races up to round N.
 */
export function teamStints(
  driverId: string,
  races: readonly StintRace[],
  sprints: readonly StintRace[] = [],
  throughRound: number | null = null,
): TeamStint[] {
  const stints = new Map<string, TeamStint>();
  const within = (race: StintRace) => Number.isFinite(roundOf(race)) && (throughRound === null || roundOf(race) <= throughRound);
  for (const race of races) {
    if (!within(race)) continue;
    const round = roundOf(race);
    for (const row of race.Results ?? []) {
      const id = row.Constructor?.constructorId;
      if (row.Driver?.driverId !== driverId || !id) continue;
      const stint = stints.get(id) ?? { constructorId: id, name: row.Constructor?.name ?? id, firstRound: round, lastRound: round, races: 0, points: 0 };
      stint.firstRound = Math.min(stint.firstRound, round);
      stint.lastRound = Math.max(stint.lastRound, round);
      stint.races += 1;
      stint.points += pointsOf(row);
      stints.set(id, stint);
    }
  }
  for (const race of sprints) {
    if (!within(race)) continue;
    for (const row of race.SprintResults ?? []) {
      const id = row.Constructor?.constructorId;
      const stint = id ? stints.get(id) : undefined;
      if (row.Driver?.driverId !== driverId || !stint) continue;
      stint.points += pointsOf(row);
    }
  }
  return [...stints.values()]
    .map((stint) => ({ ...stint, points: Number(stint.points.toFixed(2)) }))
    .sort((a, b) => a.lastRound - b.lastRound || a.firstRound - b.firstRound);
}

/**
 * The standings' Constructors reordered so the team of the driver's latest
 * race entry is last (each team placed by the latest round entered for it).
 * Teams the races do not mention keep the provider's order, ahead of the
 * proven ones. With no race evidence the provider order is returned as is.
 */
export function orderConstructorsByLatestRace<T extends { constructorId: string }>(
  constructors: readonly T[],
  driverId: string,
  races: readonly StintRace[],
  throughRound: number | null = null,
): T[] {
  const stints = teamStints(driverId, races, [], throughRound);
  if (!stints.length) return [...constructors];
  const latest = new Map(stints.map((stint) => [stint.constructorId, stint.lastRound]));
  return constructors
    .map((team, index) => ({ team, index, last: latest.get(team.constructorId) ?? -Infinity }))
    .sort((a, b) => a.last - b.last || a.index - b.index)
    .map(({ team }) => team);
}
