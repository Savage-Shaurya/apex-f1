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
