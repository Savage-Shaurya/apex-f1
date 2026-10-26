import { cache } from 'react';
import { jolpica } from '@apex/api-client/jolpica';
import { CONSTRUCTOR_CHAMPIONSHIP_FROM } from '@/lib/championship-snapshot';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import type { SeasonTable } from '../championship-history';
import { snapshotTable, STANDINGS_SNAPSHOT } from './standings-snapshot';

/**
 * Every Constructors' Championship table from 1958 to `through`.
 *
 * Completed seasons never change, so they come from a committed capture of
 * Jolpica's final tables (constructor-standings-snapshot.json, with its
 * capture date): zero provider reads for 1958 to the snapshot's last season,
 * which keeps team pages fast and working when Jolpica is slow or rate
 * limited. Seasons after the snapshot (the season in progress, or a season
 * completed since the capture) are read from Jolpica, four at a time, kept
 * for an hour (in progress) or 30 days (completed).
 *
 * A season that cannot be read is listed in `missing` and never guessed:
 * the pages say which seasons are absent instead of showing a short history
 * as if it were complete.
 */
export interface StandingsArchive {
  tables: SeasonTable[];
  missing: number[];
  from: number;
  through: number;
}

const MONTH = 30 * 86_400;

export const loadConstructorStandingsArchive = cache(async (through: number, lastCompleted: number): Promise<StandingsArchive> => {
  const from = CONSTRUCTOR_CHAMPIONSHIP_FROM;
  const years = Array.from({ length: Math.max(0, through - from + 1) }, (_, i) => through - i);
  const tables: SeasonTable[] = [];
  const missing: number[] = [];
  const live: number[] = [];
  for (const year of years) {
    const captured = year <= lastCompleted ? snapshotTable(STANDINGS_SNAPSHOT, year) : null;
    if (captured) tables.push(captured);
    else live.push(year);
  }
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, live.length) }, async () => {
    for (;;) {
      const year = live[next++];
      if (year === undefined) return;
      const read = await readPublicSport(() => jolpica.getConstructorStandingsSnapshot(year, { ...SPORT_READ_OPTIONS, revalidate: year <= lastCompleted ? MONTH : 3600 }));
      if (read.state === 'available' && read.data.standings.length) tables.push({ year, round: read.data.round, entries: read.data.standings });
      else if (read.state === 'unavailable') missing.push(year);
    }
  }));
  return { tables: tables.sort((a, b) => b.year - a.year), missing: missing.sort((a, b) => a - b), from, through };
});
