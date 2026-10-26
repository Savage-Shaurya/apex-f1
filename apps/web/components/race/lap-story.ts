/* ---------------------------------------------------------------------------
 * Lap-by-lap running order from Jolpica's lap timings (1996 onwards).
 *
 * Each lap row carries every running car's position at the end of that lap.
 * A car that stops appearing has retired (its line ends there); the start
 * of each line is its grid slot (a pit-lane start sits below the last grid
 * slot). Nothing is interpolated: a lap without a timing row is a gap.
 * ------------------------------------------------------------------------- */

export interface LapTimingInput {
  number: string;
  Timings: ReadonlyArray<{ driverId: string; position: string }>;
}

export interface LapStoryDriver {
  id: string;
  first: string;
  last: string;
  slug: string;
  /** Finishing order (1-based) on the classification, used to order lists. */
  order: number;
  /** Classified position text as published ("1", "R", "D"...). */
  positionText: string;
  /** Grid slot, null when not published; 0 = pit-lane start. */
  grid: number | null;
  /** Position at the end of each lap, index = lap - 1; null = no timing row (retired or missing). */
  positions: Array<number | null>;
  /** Laps on which this driver made a pit stop (Jolpica pit stops, 2011 onwards). */
  pitLaps: number[];
}

export interface LapStory {
  laps: number;
  /** Cars that started (for the y axis). */
  field: number;
  drivers: LapStoryDriver[];
}

export interface LapStoryResult {
  driver: { id: string; firstName: string; lastName: string; slug: string };
  positionText: string;
  grid: number | null;
}

/** Join lap timings with the classification; null when the provider returned no laps. */
export function buildLapStory(
  laps: readonly LapTimingInput[],
  results: readonly LapStoryResult[],
  pitStops: ReadonlyArray<{ driverId: string; lap: string }> = [],
): LapStory | null {
  const numbered = laps
    .map((l) => ({ n: Number(l.number), timings: l.Timings }))
    .filter((l) => Number.isInteger(l.n) && l.n > 0)
    .sort((a, b) => a.n - b.n);
  if (numbered.length === 0 || results.length === 0) return null;
  const total = numbered.at(-1)!.n;
  const byDriver = new Map<string, Array<number | null>>(results.map((r) => [r.driver.id, Array.from({ length: total }, () => null)]));
  for (const lap of numbered) {
    for (const t of lap.timings) {
      const row = byDriver.get(t.driverId);
      const pos = Number(t.position);
      if (row && Number.isInteger(pos) && pos > 0) row[lap.n - 1] = pos;
    }
  }
  const pits = new Map<string, number[]>();
  for (const p of pitStops) {
    const lap = Number(p.lap);
    if (!Number.isInteger(lap) || lap < 1) continue;
    pits.set(p.driverId, [...(pits.get(p.driverId) ?? []), lap]);
  }
  const drivers = results.map((r, i) => ({
    id: r.driver.id,
    first: r.driver.firstName,
    last: r.driver.lastName,
    slug: r.driver.slug,
    order: i + 1,
    positionText: r.positionText,
    grid: r.grid,
    positions: byDriver.get(r.driver.id)!,
    pitLaps: (pits.get(r.driver.id) ?? []).sort((a, b) => a - b),
  }));
  // A car with no lap at all (did not start, or retired before completing lap 1) has no line.
  const withLaps = drivers.filter((d) => d.positions.some((p) => p != null) || (d.grid != null && d.grid > 0));
  return { laps: total, field: Math.max(results.length, ...withLaps.map((d) => Math.max(d.grid ?? 0, ...d.positions.map((p) => p ?? 0)))), drivers };
}

/** Laps completed (last lap with a timing row). */
export function lapsRun(d: Pick<LapStoryDriver, 'positions'>): number {
  for (let i = d.positions.length - 1; i >= 0; i--) if (d.positions[i] != null) return i + 1;
  return 0;
}

/** Places gained from the grid to the last lap run (positive = gained); null without a grid slot or laps. */
export function placesFromGrid(d: Pick<LapStoryDriver, 'positions' | 'grid'>, field: number): number | null {
  const run = lapsRun(d);
  if (run === 0 || d.grid == null) return null;
  const start = d.grid === 0 ? field : d.grid;
  return start - d.positions[run - 1]!;
}

/** Biggest climb and the number of lead changes, both counted from the timing rows. */
export function lapStoryFacts(story: LapStory): { leaders: string[]; leadChanges: number } {
  const leaders: string[] = [];
  let leadChanges = 0;
  let current: string | null = null;
  for (let lap = 0; lap < story.laps; lap++) {
    const leader = story.drivers.find((d) => d.positions[lap] === 1);
    if (!leader) continue;
    if (current != null && leader.id !== current) leadChanges++;
    current = leader.id;
    if (!leaders.includes(leader.id)) leaders.push(leader.id);
  }
  return { leaders, leadChanges };
}
