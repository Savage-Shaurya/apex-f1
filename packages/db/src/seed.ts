import { sql } from 'drizzle-orm';
import { getDb } from './client';
import { boundedTransaction } from './bounded-transaction';
import { season, driver, team, standingDriver, standingTeam, sourceSnapshotEvent } from './schema';
import { completeSourceObservation, withSourceObservation, type SourceObservation, type DbTransaction } from './source-observation';
import { createHash } from 'node:crypto';

export interface DriverStandingSeed {
  slug: string; code: string; number: number | null; firstName: string; lastName: string;
  fullName: string; nationality: string; position: number; points: number; wins: number;
}
export interface TeamStandingSeed { slug: string; name: string; position: number; points: number; wins: number }
export interface StandingSnapshotRounds { driverRound: number | null; teamRound: number | null }

function validateSnapshot(rows: (DriverStandingSeed | TeamStandingSeed)[], round: number | null) {
  if (!rows.length) return;
  if (!Number.isInteger(round) || round! < 1 || round! > 30) throw new Error('Standings require their official snapshot round.');
  if (new Set(rows.map((r) => r.slug)).size !== rows.length) throw new Error('Duplicate standings source identities.');
  if (rows.some((r) => !r.slug || !Number.isInteger(r.position) || r.position < 1 || !Number.isFinite(r.points) || !Number.isInteger(r.wins) || r.wins < 0)) throw new Error('Invalid standings input.');
}

/** Persist complete provider snapshots atomically, using their actual source rounds. */
export async function persistCurrentSeason(year: number, drivers: DriverStandingSeed[], teams: TeamStandingSeed[], rounds: StandingSnapshotRounds, observation?: SourceObservation): Promise<{ drivers: number; teams: number }> {
  if (!process.env.DATABASE_URL) throw new Error('Standings persistence is not configured.');
  if (!Number.isInteger(year) || year < 1950 || year > new Date().getUTCFullYear() + 1) throw new Error('Invalid standings season.');
  validateSnapshot(drivers, rounds.driverRound);
  validateSnapshot(teams, rounds.teamRound);
  if (observation && (observation.source !== 'jolpica' || observation.scope !== `standings:${year}`)) throw new Error('Wrong standings observation scope.');
  try {
    const persist = async (tx: DbTransaction) => {
      if (observation) {
        // A newer local request cannot quietly regress to an earlier official round.
        for (const [table, rows, round] of [[standingDriver, drivers, rounds.driverRound], [standingTeam, teams, rounds.teamRound]] as const) {
          if (!rows.length) continue;
          const existing = await tx.execute(sql`select max(round)::int as latest, count(*) filter (where round = ${round} and source <> 'jolpica')::int as foreign_rows from ${table} where season_year = ${year}`);
          if (Number(existing[0]?.latest ?? 0) > round! || Number(existing[0]?.foreign_rows ?? 0) > 0) throw new Error('Standings require reviewed round/source reconciliation.');
        }
      }
      // Status belongs to the calendar reconciliation (seasonStatusFromCalendar),
      // never the clock year. Published standings mean a race has run, so a
      // missing row starts as active and the calendar sync settles it.
      await tx.insert(season).values({ year, status: 'active' }).onConflictDoNothing();
      if (drivers.length) {
        const identities = await tx.insert(driver).values(drivers.map((d) => ({ slug: d.slug, code: d.code, permanentNumber: d.number, firstName: d.firstName, lastName: d.lastName, fullName: d.fullName, nationality: d.nationality })))
          .onConflictDoUpdate({ target: driver.slug, set: { code: sql`excluded.code`, permanentNumber: sql`excluded.permanent_number`, firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name`, fullName: sql`excluded.full_name`, nationality: sql`excluded.nationality`, updatedAt: new Date() } })
          .returning({ id: driver.id, slug: driver.slug });
        const ids = new Map(identities.map((d) => [d.slug, d.id]));
        await tx.insert(standingDriver).values(drivers.map((d) => ({ seasonYear: year, driverId: ids.get(d.slug)!, round: rounds.driverRound!, position: d.position, points: d.points, wins: d.wins, ...(observation ? { source: 'jolpica' } : {}) })))
          .onConflictDoUpdate({ target: [standingDriver.seasonYear, standingDriver.round, standingDriver.driverId], set: { position: sql`excluded.position`, points: sql`excluded.points`, wins: sql`excluded.wins`, ...(observation ? { source: 'jolpica' } : {}), updatedAt: new Date() } });
        if (observation) await tx.execute(sql`delete from standing_driver where season_year = ${year} and round = ${rounds.driverRound} and source = 'jolpica' and driver_id <> all(ARRAY[${sql.join([...ids.values()].map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`);
      }
      if (teams.length) {
        const identities = await tx.insert(team).values(teams.map((t) => ({ slug: t.slug, name: t.name })))
          .onConflictDoUpdate({ target: team.slug, set: { name: sql`excluded.name`, updatedAt: new Date() } }).returning({ id: team.id, slug: team.slug });
        const ids = new Map(identities.map((t) => [t.slug, t.id]));
        await tx.insert(standingTeam).values(teams.map((t) => ({ seasonYear: year, teamId: ids.get(t.slug)!, round: rounds.teamRound!, position: t.position, points: t.points, wins: t.wins, ...(observation ? { source: 'jolpica' } : {}) })))
          .onConflictDoUpdate({ target: [standingTeam.seasonYear, standingTeam.round, standingTeam.teamId], set: { position: sql`excluded.position`, points: sql`excluded.points`, wins: sql`excluded.wins`, ...(observation ? { source: 'jolpica' } : {}), updatedAt: new Date() } });
        if (observation) await tx.execute(sql`delete from standing_team where season_year = ${year} and round = ${rounds.teamRound} and source = 'jolpica' and team_id <> all(ARRAY[${sql.join([...ids.values()].map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[])`);
      }
      const summary = { drivers: drivers.length, teams: teams.length };
      if (observation) {
        await completeSourceObservation(tx, observation, createHash('sha256').update(JSON.stringify({ drivers, teams, rounds })).digest('hex'), summary);
        await tx.insert(sourceSnapshotEvent).values({ source: observation.source, scope: observation.scope, generation: BigInt(observation.generation), observationId: observation.observationId, summary: { ...summary, ...rounds } });
      }
      return summary;
    };
    return observation ? await withSourceObservation(observation, persist) : await boundedTransaction(getDb(), persist);
  } catch (cause) { throw new Error('Failed to persist standings snapshot.', { cause }); }
}
