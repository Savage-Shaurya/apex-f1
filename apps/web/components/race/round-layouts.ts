import type { CircuitFacts } from '@/lib/circuits/facts';

/* ---------------------------------------------------------------------------
 * Rounds that ran on a different layout from another round at the same
 * circuit in the same season. Circuit facts are keyed by season and circuit
 * (lib/circuits/facts.ts), so both rounds would otherwise share one answer
 * (D2-CODE-QUALITY-1). Each entry is a published fact with its source; the
 * bundled outline is the main layout, so it is not drawn for these rounds.
 * Remove an entry once lib/circuits keys facts by round.
 * ------------------------------------------------------------------------- */

export interface RoundLayout {
  layoutName: string;
  lengthKm: number;
  source: string;
}

const ROUND_LAYOUTS: Record<string, RoundLayout> = {
  // 2020 Sakhir Grand Prix: Bahrain International Circuit, Outer Circuit, 3.543 km (87 laps).
  '2020:16': { layoutName: 'Outer Circuit', lengthKm: 3.543, source: 'https://en.wikipedia.org/wiki/2020_Sakhir_Grand_Prix' },
};

export function roundLayout(race: { season: number; round: number }): RoundLayout | null {
  return ROUND_LAYOUTS[`${race.season}:${race.round}`] ?? null;
}

/** Facts for one round: the season facts, corrected for a round that used another layout. */
export function factsForRound(race: { season: number; round: number }, facts: CircuitFacts | undefined): CircuitFacts | undefined {
  const layout = roundLayout(race);
  if (!layout) return facts;
  return { lengthKm: layout.lengthKm, lengthStatus: 'published', showOutline: false, layoutName: layout.layoutName };
}
