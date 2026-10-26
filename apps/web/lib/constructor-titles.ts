import type { JolpicaConstructorStandingEntry } from '@apex/api-client/jolpica';
import type { ChampionshipArchive } from './championship-archive';

/**
 * Constructors' Championship (WCC) counts derived from the champion archive
 * (Jolpica final standings, P1 per completed season), keyed by Jolpica
 * constructorId. No hand-maintained counts.
 *
 * Jolpica credits early titles to engine-suffixed entrant ids: 1959-60
 * `cooper-climax`, 1963/65 `lotus-climax`, 1966-67 `brabham-repco`, 1968
 * `lotus-ford`, 1969 `matra-ford`. An id's own page counts exactly the titles credited to that
 * id; the marque page (`cooper`, `team_lotus`, `brabham`, `matra`) also counts
 * its suffixed entries and lists them, so both pages stay truthful.
 * `lotus_f1` (Enstone, 2012-15) is a different team and is not a Lotus alias.
 */
export const CONSTRUCTOR_TITLE_ALIASES: Readonly<Record<string, string>> = {
  // Only ids that Jolpica actually credits with a title (verified 2026-10-25 against every season 1958-2025).
  'cooper-climax': 'cooper', // 1959, 1960
  'lotus-climax': 'team_lotus', // 1963, 1965
  'lotus-ford': 'team_lotus', // 1968
  'brabham-repco': 'brabham', // 1966, 1967
  'matra-ford': 'matra', // 1969
};

export interface ConstructorTitleRecord {
  /** Titles credited to this exact id plus its aliased entrant ids. */
  titles: number;
  /** Seasons won, newest first. */
  years: number[];
  /** Aliased entrant ids that contributed, oldest first, each with its seasons ascending. */
  viaAliases: Array<{ id: string; name: string; years: number[] }>;
  /** Last completed season the count covers. */
  through: number;
}

/** "unknown" whenever the archive is incomplete: a missing season could belong to anyone, so no count (and no 0) is claimed. */
export type ConstructorTitles = { state: 'confirmed'; record: ConstructorTitleRecord } | { state: 'unknown'; through: number };

export function constructorTitlesFromArchive(constructorId: string, archive: ChampionshipArchive<JolpicaConstructorStandingEntry>): ConstructorTitles {
  if (archive.state !== 'complete') return { state: 'unknown', through: archive.through };
  const years: number[] = [];
  const aliases = new Map<string, { id: string; name: string; years: number[] }>();
  for (const { year, winner } of archive.records) {
    const id = winner.Constructor.constructorId;
    if (id === constructorId) years.push(year);
    else if (CONSTRUCTOR_TITLE_ALIASES[id] === constructorId) {
      years.push(year);
      const alias = aliases.get(id) ?? { id, name: winner.Constructor.name, years: [] };
      alias.years.push(year);
      aliases.set(id, alias);
    }
  }
  years.sort((a, b) => b - a);
  const viaAliases = [...aliases.values()].map(alias => ({ ...alias, years: alias.years.sort((a, b) => a - b) })).sort((a, b) => a.years[0]! - b.years[0]!);
  return { state: 'confirmed', record: { titles: years.length, years, viaAliases, through: archive.through } };
}
