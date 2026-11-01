import { cache } from 'react';
import { readDriverIdentity } from '@/lib/public-sport';
import { snapshotChampionDriver } from '@/lib/championship-snapshot';

type IdentityRead = (slug: string) => ReturnType<typeof readDriverIdentity>;

/**
 * The driver's Jolpica record. When the live read is unavailable, a world
 * champion's record comes from the committed championship capture (the same
 * Jolpica object, captured earlier), so the profile renders instead of the
 * layout's outage error (audit 2026-11-01 DRV-1). Anyone else stays honestly
 * unavailable; a confirmed miss is never overridden.
 */
export async function readDriverRecord(slug: string, read: IdentityRead = readDriverIdentity): ReturnType<typeof readDriverIdentity> {
  const record = await read(slug);
  if (record.state !== 'unavailable') return record;
  const champion = snapshotChampionDriver(slug);
  return champion ? { state: 'found', raw: champion } : record;
}

/** Metadata and page share the same strict lookup during one server render. */
export const loadDriver = cache((slug: string) => readDriverRecord(slug));
