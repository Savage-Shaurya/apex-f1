import { sql } from 'drizzle-orm';
import { getWorkerDb } from './client';

/**
 * Rounds of a season that already hold a persisted race classification.
 * The nightly job uses this to fill missing rounds first, so a fresh database
 * reaches a complete season in a few bounded runs instead of a random rotation.
 */
export async function listClassifiedRounds(season: number): Promise<number[]> {
  if (!Number.isSafeInteger(season) || season < 1950 || season > 2200) throw new Error('Invalid classification season.');
  if (!process.env.DATABASE_URL) throw new Error('Classification persistence is not configured.');
  const rows = await getWorkerDb().execute(sql`
    select distinct r.round::int as round
    from race r
    where r.season_year = ${season} and exists (select 1 from result x where x.race_id = r.id)
    order by 1`);
  return rows.map((row) => Number(row.round)).filter((round) => Number.isSafeInteger(round) && round >= 1 && round <= 40);
}
