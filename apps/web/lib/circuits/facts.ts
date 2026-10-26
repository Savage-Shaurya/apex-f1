import { circuitFactsForSeason, getCircuitInfoboxes, type CircuitLayout } from '@apex/api-client/wikipedia';
import { getCircuit } from './index';

/**
 * Season-aware circuit facts for race and schedule pages.
 *
 *  - Lap length comes from the circuit's Wikipedia infobox (Jolpica
 *    `Circuit.url`), for the layout that was in use that season. Cached
 *    30 days. No infobox length means "Not published"; a failed read means
 *    "Unavailable". The bundled outline data's own length is never shown.
 *  - The bundled outline (bacinger/f1-circuits) is today's layout, so it is
 *    drawn only when the season ran on the infobox's primary layout. When the
 *    infobox cannot be read, only current/future seasons keep the outline.
 */

export type LapLengthStatus = 'published' | 'not-published' | 'unavailable';

export interface CircuitFacts {
  lengthKm: number | null;
  lengthStatus: LapLengthStatus;
  /** Draw the bundled modern outline for this race. */
  showOutline: boolean;
  /** Infobox layout name used for the season, when one matched. */
  layoutName: string | null;
}

export interface CircuitFactsRace {
  circuitId: string;
  circuitWikiUrl?: string;
  season: number;
  /** Championship round. Two rounds can share a circuit and season on different layouts (2020 Bahrain + Sakhir). */
  round?: number;
}

/**
 * Races that ran on a different configuration of a circuit from the season's
 * other race there. The layout is still read from the circuit's infobox (its
 * length is Wikipedia's, never typed in here); the bundled outline is the
 * Grand Prix layout, so it is not drawn.
 *   - 2020 Sakhir Grand Prix (round 16): Bahrain Outer Circuit.
 */
export const RACE_LAYOUT_OVERRIDES: Readonly<Record<string, { circuitId: string; layout: RegExp }>> = {
  '2020:16': { circuitId: 'bahrain', layout: /^outer circuit\b/i },
};

export type InfoboxReader = (urls: readonly string[]) => Promise<Map<string, CircuitLayout[]>>;

const readInfoboxes: InfoboxReader = (urls) => getCircuitInfoboxes(urls, { strict: true });

/** One entry per race: season + round when known, so two rounds at one circuit never share an answer. */
export const circuitFactsKey = (race: Pick<CircuitFactsRace, 'circuitId' | 'season' | 'round'>) =>
  race.round !== undefined ? `${race.season}:r${race.round}:${race.circuitId}` : `${race.season}:${race.circuitId}`;

/** Pure decision for one race given its infobox layouts (or `null` when unread). */
export function decideCircuitFacts(race: CircuitFactsRace, layouts: CircuitLayout[] | null, currentYear: number): CircuitFacts {
  const hasOutline = getCircuit(race.circuitId) !== null;
  const override = race.round !== undefined ? RACE_LAYOUT_OVERRIDES[`${race.season}:${race.round}`] : undefined;
  if (override && override.circuitId === race.circuitId) {
    if (layouts === null) return { lengthKm: null, lengthStatus: 'unavailable', showOutline: false, layoutName: null };
    const layout = layouts.find((candidate) => override.layout.test(candidate.name)) ?? null;
    return {
      lengthKm: layout?.lengthKm ?? null,
      lengthStatus: layout?.lengthKm != null ? 'published' : 'not-published',
      showOutline: false,
      layoutName: layout?.name ?? null,
    };
  }
  if (layouts === null) {
    return { lengthKm: null, lengthStatus: 'unavailable', showOutline: hasOutline && race.season >= currentYear, layoutName: null };
  }
  const season = circuitFactsForSeason(layouts, race.season, currentYear);
  const showOutline = hasOutline && (layouts.length ? season.primaryLayout : race.season >= currentYear);
  return {
    lengthKm: season.lengthKm,
    lengthStatus: season.lengthKm === null ? 'not-published' : 'published',
    showOutline,
    layoutName: season.layoutName,
  };
}

export async function loadCircuitFacts(
  races: readonly CircuitFactsRace[],
  opts: { now?: number; reader?: InfoboxReader } = {},
): Promise<Map<string, CircuitFacts>> {
  const currentYear = new Date(opts.now ?? Date.now()).getUTCFullYear();
  const urls = [...new Set(races.map((r) => r.circuitWikiUrl).filter((u): u is string => Boolean(u)))];
  let infoboxes: Map<string, CircuitLayout[]> | null = null;
  if (urls.length) {
    try { infoboxes = await (opts.reader ?? readInfoboxes)(urls); }
    catch { infoboxes = null; }
  }
  const out = new Map<string, CircuitFacts>();
  for (const race of races) {
    const layouts = !race.circuitWikiUrl ? [] : infoboxes === null ? null : infoboxes.get(race.circuitWikiUrl) ?? null;
    out.set(circuitFactsKey(race), decideCircuitFacts(race, layouts, currentYear));
  }
  return out;
}

export function formatLapLength(facts: CircuitFacts | undefined): string {
  if (!facts) return 'Unavailable';
  // Published precision as the infobox states it (5.419, 5.38), never padded.
  if (facts.lengthKm !== null) return `${facts.lengthKm} km`;
  return facts.lengthStatus === 'unavailable' ? 'Unavailable' : 'Not published';
}
