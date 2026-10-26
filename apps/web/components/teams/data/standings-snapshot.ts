import type { SeasonTable, StandingEntry } from '../championship-history';
import captured from './constructor-standings-snapshot.json';

/** Committed capture of Jolpica's final Constructors' Championship tables. */
export interface StandingsSnapshot {
  source: string;
  capturedAt: string;
  from: number;
  through: number;
  seasons: Array<{ year: number; round: number | null; entries: StandingEntry[] }>;
}

export const STANDINGS_SNAPSHOT = captured as StandingsSnapshot;

/** The captured final table for a season, or null when the capture does not hold it. */
export function snapshotTable(snapshot: StandingsSnapshot, year: number): SeasonTable | null {
  if (year < snapshot.from || year > snapshot.through) return null;
  const season = snapshot.seasons.find((s) => s.year === year);
  return season && season.entries.length ? { year, round: season.round, entries: season.entries } : null;
}
