/* ---------------------------------------------------------------------------
 * Presentation maths for the standings sheet. Everything here is derived
 * from values the page already shows (the official table, the published
 * calendar, the proven round-by-round totals); nothing is estimated.
 * ------------------------------------------------------------------------- */

export interface SheetRound {
  round: number;
  /** True when the weekend has a sprint (more points on offer). */
  sprint: boolean;
}

/**
 * Most points one entry can still add at a round under the current rules
 * (2025 on: no fastest-lap point). Drivers: win 25, sprint win 8.
 * Constructors: a one-two, 25 + 18, and 8 + 7 in a sprint.
 */
export function maxRoundPoints(kind: 'drivers' | 'teams', round: SheetRound): number {
  return kind === 'drivers' ? 25 + (round.sprint ? 8 : 0) : 43 + (round.sprint ? 15 : 0);
}

export interface TitleMaths {
  gap: number;
  roundsLeft: number;
  pointsLeft: number;
  /** The leader's lead is larger than everything still on offer. */
  clinched: boolean;
  /** Ids (leader excluded) who can still at least draw level on points. */
  alive: string[];
}

/**
 * Title arithmetic for a season in progress, from the official table after
 * `afterRound` and the rounds the published calendar still holds. Null when
 * it cannot be stated truthfully (fewer than two entries, or no calendar).
 */
export function titleMaths(
  kind: 'drivers' | 'teams',
  table: ReadonlyArray<{ id: string; points: number }>,
  calendar: readonly (SheetRound & { done?: boolean })[],
  afterRound: number,
): TitleMaths | null {
  const [leader, rival] = table;
  if (!leader || !rival || !calendar.length || !Number.isFinite(leader.points) || !Number.isFinite(rival.points)) return null;
  const remaining = calendar.filter((r) => r.round > afterRound);
  const pointsLeft = remaining.reduce((sum, r) => sum + maxRoundPoints(kind, r), 0);
  const gap = round2(leader.points - rival.points);
  const alive = table.slice(1).filter((t) => Number.isFinite(t.points) && t.points + pointsLeft >= leader.points).map((t) => t.id);
  return { gap, roundsLeft: remaining.length, pointsLeft, clinched: gap > pointsLeft, alive };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ChartMode = 'points' | 'gap' | 'position';

/**
 * Value of one entry at one round for a chart mode: running points, points
 * behind whoever led after that round, or championship position.
 */
export function seriesValue(
  mode: ChartMode,
  totals: Readonly<Record<string, readonly number[]>>,
  positions: Readonly<Record<string, readonly number[]>>,
  id: string,
  index: number,
): number | null {
  if (mode === 'position') return positions[id]?.[index] ?? null;
  const v = totals[id]?.[index];
  if (v == null) return null;
  if (mode === 'points') return v;
  let lead = -Infinity;
  for (const t of Object.values(totals)) lead = Math.max(lead, t[index] ?? -Infinity);
  return round2(lead - v);
}

/** Number formatting used across the sheet: integers stay whole, halves keep one decimal. */
export function fmtPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

/** Champions in a block of seasons, most titles first, then the earliest title. */
export function titleCounts(rows: ReadonlyArray<{ year: number; champion: string | null }>): Array<{ name: string; titles: number }> {
  const by = new Map<string, { titles: number; first: number }>();
  for (const r of rows) {
    if (!r.champion) continue;
    const e = by.get(r.champion);
    if (e) { e.titles += 1; e.first = Math.min(e.first, r.year); }
    else by.set(r.champion, { titles: 1, first: r.year });
  }
  return [...by.entries()].sort((a, b) => b[1].titles - a[1].titles || a[1].first - b[1].first).map(([name, e]) => ({ name, titles: e.titles }));
}

/**
 * A visible note for a published table known to differ from the official
 * classification (R3-DATA-4). The published figures are never retyped; the
 * note says what the official order is.
 */
export function tableNote(kind: 'drivers' | 'teams', season: number): string | null {
  if (kind === 'teams' && season === 2018) {
    return 'Officially, Haas F1 Team finished 5th (93 points), McLaren 6th (62) and Racing Point Force India 7th (52). The table below adds the 59 points Sahara Force India scored in rounds 1 to 12, which were not carried over to the new entry, so it ranks Force India 5th on 111. The published figures are shown unchanged.';
  }
  return null;
}
