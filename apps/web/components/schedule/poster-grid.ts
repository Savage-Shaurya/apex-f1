/**
 * Layout helpers for the season calendar (pure, tested).
 */

/**
 * "Every round" as one continuous grid: the month name rides on the first
 * round of each month instead of opening a new grid, so short months never
 * leave empty columns (SRL-4). Returns round -> month for those first rounds.
 */
export function monthMarkers(months: ReadonlyArray<{ month: string; rounds: readonly number[] }>): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of months) {
    const first = m.rounds[0];
    if (first !== undefined && !out.has(first)) out.set(first, m.month);
  }
  return out;
}

/** The rounds in calendar order, flattened from the month groups, each once. */
export function gridOrder(months: ReadonlyArray<{ rounds: readonly number[] }>): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of months) for (const r of m.rounds) if (!seen.has(r)) { seen.add(r); out.push(r); }
  return out;
}

export type StripState = 'run' | 'focus' | 'ahead';

export interface StripRound<O> {
  round: number;
  name: string;
  outline: O | null;
  state: StripState;
}

/**
 * The hero's strip of the season's real circuit outlines (SRL-2): rounds
 * whose race has started are run, the calendar's focus round (next or live)
 * carries the comet, the rest are ahead. Rounds without a drawable outline
 * stay in the strip as their round number so the count is true.
 */
export function heroStrip<O>(rounds: ReadonlyArray<{ round: number; name: string; raceIso: string; outline: O | null }>, focusRound: number | null, now: number): Array<StripRound<O>> {
  return rounds.map((r) => {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(r.raceIso) ? Date.parse(`${r.raceIso}T12:00:00Z`) : Date.parse(r.raceIso);
    const state: StripState = r.round === focusRound ? 'focus' : Number.isFinite(t) && t <= now ? 'run' : 'ahead';
    return { round: r.round, name: r.name, outline: r.outline, state };
  });
}

/** True when the strip has at least one real outline to draw (else the hero keeps its stats only). */
export function stripHasOutlines(strip: ReadonlyArray<{ outline: unknown }>): boolean {
  return strip.some((s) => s.outline !== null);
}
