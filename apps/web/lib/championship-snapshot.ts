import type { JolpicaConstructorStandingEntry, JolpicaDriverStandingEntry } from '@apex/api-client/jolpica';
import raw from './data/championship-snapshot.json';

/**
 * Completed-season champions, captured verbatim from Jolpica's final standings
 * by scripts/build-championship-snapshot.mjs. Seasons after `through` are read
 * live (components/data/load-championship-archive.ts). Validated on load so a
 * hand-edited or truncated file fails loudly instead of rendering wrong totals.
 */
interface SnapshotRow<T> { year: number; round: number; source: string; entry: T }
interface Snapshot {
  provider: string;
  generatedAt: string;
  through: number;
  drivers: SnapshotRow<JolpicaDriverStandingEntry>[];
  constructors: SnapshotRow<JolpicaConstructorStandingEntry>[];
}

export const DRIVER_CHAMPIONSHIP_FROM = 1950;
export const CONSTRUCTOR_CHAMPIONSHIP_FROM = 1958;

export function validateChampionshipSnapshot(value: unknown): Snapshot {
  const snapshot = value as Snapshot;
  const fail = (why: string): never => { throw new Error(`Invalid championship snapshot: ${why}`); };
  if (!snapshot || typeof snapshot !== 'object' || !Number.isSafeInteger(snapshot.through) || !Array.isArray(snapshot.drivers) || !Array.isArray(snapshot.constructors)) fail('shape');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.generatedAt)) fail('generatedAt');
  const check = <T extends { position?: string; positionText: string }>(rows: SnapshotRow<T>[], from: number, id: (entry: T) => unknown, resource: string) => {
    if (rows.length !== snapshot.through - from + 1) fail(`${resource} covers ${rows.length} seasons`);
    rows.forEach((row, index) => {
      if (row.year !== from + index || !Number.isSafeInteger(row.round) || row.round < 1) fail(`${resource} ${row.year}`);
      if (row.source !== `https://api.jolpi.ca/ergast/f1/${row.year}/${resource}/1.json`) fail(`${resource} ${row.year} source`);
      if (row.entry?.position !== '1' || row.entry.positionText !== '1' || typeof id(row.entry) !== 'string') fail(`${resource} ${row.year} entry`);
    });
  };
  check(snapshot.drivers, DRIVER_CHAMPIONSHIP_FROM, entry => entry.Driver?.driverId, 'driverStandings');
  check(snapshot.constructors, CONSTRUCTOR_CHAMPIONSHIP_FROM, entry => entry.Constructor?.constructorId, 'constructorStandings');
  return snapshot;
}

const snapshot = validateChampionshipSnapshot(raw);

export const CHAMPIONSHIP_SNAPSHOT_THROUGH = snapshot.through;
export const CHAMPIONSHIP_SNAPSHOT_DATE = snapshot.generatedAt;

/** Snapshot champions up to and including `to`, newest first. */
export function snapshotDriverChampions(to: number): Array<{ year: number; winner: JolpicaDriverStandingEntry }> {
  return snapshot.drivers.filter(row => row.year <= to).map(row => ({ year: row.year, winner: row.entry })).reverse();
}
export function snapshotConstructorChampions(to: number): Array<{ year: number; winner: JolpicaConstructorStandingEntry }> {
  return snapshot.constructors.filter(row => row.year <= to).map(row => ({ year: row.year, winner: row.entry })).reverse();
}

/**
 * A world champion's Jolpica driver record from the committed capture (the same
 * `Driver` object Jolpica returns), or null for anyone who never won a title.
 * Used when the live identity read is unavailable, so a champion's profile still
 * renders (audit 2026-11-01 DRV-1).
 */
export function snapshotChampionDriver(driverId: string): JolpicaDriverStandingEntry['Driver'] | null {
  return snapshot.drivers.find(row => row.entry.Driver.driverId === driverId)?.entry.Driver ?? null;
}
/** Every driver and constructor that has won a title, oldest first, each once. */
export function snapshotChampionIds(): { drivers: string[]; constructors: string[] } {
  return {
    drivers: [...new Set(snapshot.drivers.map(row => row.entry.Driver.driverId))],
    constructors: [...new Set(snapshot.constructors.map(row => row.entry.Constructor.constructorId))],
  };
}

/** Champions with at least this many titles are prebuilt (review 2026-11-01, finding 3). */
export const PREBUILD_MIN_TITLES = 3;
/** ...and so is anyone who won a title in this many most recent captured seasons. */
export const PREBUILD_RECENT_SEASONS = 26;

/**
 * The champions worth prebuilding at `next build`: multiple champions
 * (PREBUILD_MIN_TITLES or more titles) and the champions of the last
 * PREBUILD_RECENT_SEASONS seasons, most titles first, then the most recent.
 * Prebuilding every champion cost ~150-250 Jolpica reads per build (Jolpica
 * allows ~4/s and 500/h; a cold build met dozens of 429s and baked pages in
 * their outage state). Every other champion renders on its first visit and
 * is then served from the ISR cache.
 */
export function prebuildChampionIds(): { drivers: string[]; constructors: string[] } {
  const since = snapshot.through - PREBUILD_RECENT_SEASONS + 1;
  const rank = <T>(rows: SnapshotRow<T>[], id: (entry: T) => string): string[] => {
    const stats = new Map<string, { titles: number; last: number }>();
    for (const row of rows) {
      const key = id(row.entry);
      const s = stats.get(key) ?? { titles: 0, last: 0 };
      s.titles++;
      s.last = Math.max(s.last, row.year);
      stats.set(key, s);
    }
    return [...stats]
      .filter(([, s]) => s.titles >= PREBUILD_MIN_TITLES || s.last >= since)
      .sort(([, a], [, b]) => b.titles - a.titles || b.last - a.last)
      .map(([key]) => key);
  };
  return {
    drivers: rank(snapshot.drivers, entry => entry.Driver.driverId),
    constructors: rank(snapshot.constructors, entry => entry.Constructor.constructorId),
  };
}
