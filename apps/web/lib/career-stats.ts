/**
 * Career totals from a driver's Jolpica Grand Prix results.
 *
 * Jolpica records a FastestLap only from the 2004 season onward (checked:
 * `/2003/fastest/1/results` has 0 rows, `/2004/...` has all 18 rounds), so a
 * fastest-lap count is complete only for careers that started in 2004 or later.
 * For earlier careers the published F1 infobox figure is used when available;
 * otherwise the count is shown as partial or unavailable, never as a false 0.
 */
export const FASTEST_LAP_RECORDS_FROM = 2004;

export interface CareerResultInput {
  season: number;
  /** Classified finishing position; null when not classified (retired, DSQ, DNQ...). */
  position: number | null;
  grid: number | null;
  points: number;
  fastestLapRank: number | null;
}

export interface CareerTotals {
  entries: number;
  wins: number;
  podiums: number;
  /** Starts from P1 on the grid (Jolpica `grid` = 1). */
  gridP1Starts: number;
  points: number;
  fastestLaps: {
    /** Rank-1 fastest laps found in Jolpica results. */
    recorded: number;
    /** "full": every entry falls in a season with fastest-lap records. */
    coverage: 'full' | 'partial' | 'none';
    /** Entries in seasons before fastest-lap records began. */
    entriesWithoutRecords: number;
  };
}

export function aggregateCareer(results: readonly CareerResultInput[]): CareerTotals {
  let wins = 0, podiums = 0, poles = 0, points = 0, fastest = 0, uncovered = 0;
  for (const result of results) {
    if (result.position === 1) wins++;
    if (result.position !== null && result.position <= 3) podiums++;
    if (result.grid === 1) poles++;
    points += result.points;
    if (result.season < FASTEST_LAP_RECORDS_FROM) uncovered++;
    else if (result.fastestLapRank === 1) fastest++;
  }
  return {
    entries: results.length,
    wins,
    podiums,
    gridP1Starts: poles,
    points: Math.round(points * 100) / 100,
    fastestLaps: {
      recorded: fastest,
      coverage: !results.length || uncovered === 0 ? 'full' : uncovered === results.length ? 'none' : 'partial',
      entriesWithoutRecords: uncovered,
    },
  };
}

export interface FastestLapDisplay {
  value: number | string;
  sub?: string;
}

/**
 * Pick the truthful figure to show. A full Jolpica count wins; otherwise the
 * Wikipedia F1 infobox figure (when it is at least the partial Jolpica count);
 * otherwise a labelled partial count or "Not recorded".
 */
export function fastestLapDisplay(totals: CareerTotals, infoboxFastestLaps: number | null | undefined): FastestLapDisplay {
  const { recorded, coverage } = totals.fastestLaps;
  if (coverage === 'full') return { value: recorded };
  if (typeof infoboxFastestLaps === 'number' && infoboxFastestLaps >= recorded) {
    return { value: infoboxFastestLaps, sub: `Career total · race-by-race from ${FASTEST_LAP_RECORDS_FROM}` };
  }
  if (coverage === 'partial') return { value: recorded, sub: `${FASTEST_LAP_RECORDS_FROM} onward only · earlier laps not recorded` };
  return { value: 'n/a', sub: `Not recorded before ${FASTEST_LAP_RECORDS_FROM}` };
}

/**
 * Best classified finish in a set of results. Jolpica gives every entry an
 * order `position`, including retirements (positionText "R", "D", "W", ...),
 * so only rows whose positionText is a number count as a finish.
 */
export function bestClassifiedFinish(results: readonly { position: number | null; positionText: string }[]): number | null {
  let best: number | null = null;
  for (const { position, positionText } of results) {
    if (position === null || !/^\d+$/.test(positionText)) continue;
    if (best === null || position < best) best = position;
  }
  return best;
}

export interface RaceRow {
  position: number | null;
  positionText: string;
  grid?: number | null;
  points?: number;
  fastestLap?: { rank: number } | undefined;
}

const isClassified = (row: RaceRow): row is RaceRow & { position: number } =>
  row.position !== null && Number.isFinite(row.position) && /^\d+$/.test(row.positionText);

/**
 * The row that represents a driver's race. In the 1950s a driver could take
 * over a team-mate's car and hold two rows in one race; the best classified
 * row wins, otherwise the best-ordered unclassified one.
 */
export function primaryRaceResult<T extends RaceRow>(rows: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (!best) { best = row; continue; }
    const a = isClassified(row), b = isClassified(best);
    if (a !== b) { if (a) best = row; continue; }
    if ((row.position ?? Infinity) < (best.position ?? Infinity)) best = row;
  }
  return best;
}

/** One career entry per Grand Prix: best classified finish, summed points, any P1 grid start or fastest lap. */
export function careerInputForRace(season: number, rows: readonly RaceRow[]): CareerResultInput | null {
  const primary = primaryRaceResult(rows);
  if (!primary) return null;
  const ranks = rows.map((row) => row.fastestLap?.rank).filter((rank): rank is number => Number.isFinite(rank));
  return {
    season,
    position: isClassified(primary) ? primary.position : null,
    grid: rows.some((row) => row.grid === 1) ? 1 : primary.grid ?? null,
    points: Math.round(rows.reduce((sum, row) => sum + (Number.isFinite(row.points) ? row.points! : 0), 0) * 100) / 100,
    fastestLapRank: ranks.length ? Math.min(...ranks) : null,
  };
}
