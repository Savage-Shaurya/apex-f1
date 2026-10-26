/** Strict resumable historical ingestion; each completed classification is an atomic source-owned snapshot. */
import { sql } from 'drizzle-orm';
import { jolpica, mapRace, mapDriver, mapConstructor, mapDriverStanding, mapConstructorStanding, isRankedStanding, invalidateLocalJolpicaSeason } from '@apex/api-client/jolpica';
import {
  getWorkerDb, schema, closeDb, beginSourceObservation, withSourceObservation,
  reconcileRaceCalendar, persistRaceClassificationSnapshot, persistCurrentSeason, seasonStatusFromCalendar,
} from '@apex/db';
import { runWorker, sleep } from './lib/runner';

const delayMs = Number(process.env.JOLPICA_DELAY_MS) || 8_000;
if (!Number.isFinite(delayMs) || delayMs < 8_000) throw new Error('JOLPICA_DELAY_MS must be at least 8000.');
function parseArgs() {
  const values: Record<string, number> = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    const value = Number(args[index + 1]);
    if (!key || !['since', 'until'].includes(key) || values[key] !== undefined || !Number.isInteger(value) || value < 1950 || value > new Date().getUTCFullYear() + 1) throw new Error('Use valid --since/--until season years.');
    values[key] = value;
  }
  if (values.since && values.until && values.since > values.until) throw new Error('The starting season must precede the ending season.');
  return values;
}

async function main() {
  const range = parseArgs();
  await runWorker('jolpica-historical', async (job) => {
    let nextRequestAt = 0;
    const pacedFetch: typeof fetch = async (input, init) => {
      job.assertActive();
      const start = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = start + delayMs;
      if (start > Date.now()) await sleep(start - Date.now(), init?.signal ?? job.signal);
      job.assertActive();
      return fetch(input, init);
    };
    const options = { revalidate: 0, strict: true, signal: job.signal, fetchImpl: pacedFetch, timeoutMs: 30_000, deadlineMs: 15 * 60_000 };
    const observe = (scope: string) => beginSourceObservation({ source: 'jolpica', scope, ttlSeconds: 3_600, jobLease: job.lease });
    const seasons = (await jolpica.getSeasons(options)).map((row) => Number(row.season)).filter((year) => year >= (range.since ?? 1950) && year <= (range.until ?? Number.POSITIVE_INFINITY)).sort((a, b) => a - b);
    if (!seasons.length) throw new Error('The requested historical season collection is empty.');
    for (const year of seasons) {
      job.assertActive();
      job.log(`season ${year}`);
      const entityObservation = await observe(`entities:${year}`);
      const drivers = await jolpica.getDrivers(year, options);
      const teams = await jolpica.getConstructors(year, options);
      const calendarObservation = await observe(`calendar:${year}`);
      const schedule = (await jolpica.getSchedule(year, options)).map(mapRace);
      await withSourceObservation(entityObservation, async (tx) => {
        // Status follows the season's real calendar, not the clock year.
        await tx.insert(schema.season).values({ year, status: seasonStatusFromCalendar(schedule) }).onConflictDoNothing();
        for (const entry of drivers.map(mapDriver)) {
          await tx.insert(schema.driver).values({ slug: entry.slug, code: entry.code ?? null, permanentNumber: entry.number, firstName: entry.firstName, lastName: entry.lastName, fullName: entry.fullName, nationality: entry.nationality || 'Unknown', dob: entry.dob || null, wikiUrl: entry.wikiUrl })
            .onConflictDoUpdate({ target: schema.driver.slug, set: { dob: sql`coalesce(excluded.dob, driver.dob)`, wikiUrl: sql`coalesce(excluded.wiki_url, driver.wiki_url)` } });
        }
        for (const entry of teams.map(mapConstructor)) await tx.insert(schema.team).values({ slug: entry.slug, name: entry.name, wikiUrl: entry.wikiUrl }).onConflictDoUpdate({ target: schema.team.slug, set: { wikiUrl: sql`coalesce(excluded.wiki_url, team.wiki_url)` } });
      });
      await reconcileRaceCalendar(year, schedule, calendarObservation);
      job.bump({ itemsIn: drivers.length + teams.length + schedule.length, itemsOut: drivers.length + teams.length + schedule.length });
      for (const race of schedule) {
        if (Date.parse(race.raceStartIso) + 3 * 3_600_000 >= Date.now()) continue;
        const observation = await observe(`classification:${year}:${race.round}`);
        // Each read gets its request budget only after the previous paced
        // collection finishes; parallel starts would expire while queued.
        const result = await jolpica.getRaceResults(year, race.round, options);
        const qualifying = await jolpica.getQualifyingFull(year, race.round, options);
        const sprintResults = race.sessions.some((session) => session.kind === 'S') ? await jolpica.getSprint(year, race.round, options) : undefined;
        const pitStops = year >= 2011 ? await jolpica.getPitStops(year, race.round, options) : undefined;
        const laps = process.env.INGEST_LAPS === '1' && year >= 1996 ? await jolpica.getLaps(year, race.round, options) : undefined;
        job.assertActive();
        if (!result?.results.length) throw new Error(`No verified classification for ${year} round ${race.round}; rerun required.`);
        if (Number(result.race.season) !== year || Number(result.race.round) !== race.round) throw new Error('Classification identity differs from requested race.');
        const saved = await persistRaceClassificationSnapshot({ season: year, round: race.round, results: result.results, qualifying, sprintResults, pitStops, laps, observation });
        job.bump({ itemsOut: saved.results + saved.qualifying + (saved.sprintResults ?? 0) + (saved.pitStops ?? 0) + (saved.laps ?? 0) });
      }
      const standingsObservation = await observe(`standings:${year}`);
      const driverSnapshot = await jolpica.getDriverStandingsSnapshot(year, options);
      const teamSnapshot = await jolpica.getConstructorStandingsSnapshot(year, options);
      if ((driverSnapshot.standings.length && driverSnapshot.season !== String(year)) || (teamSnapshot.standings.length && teamSnapshot.season !== String(year))) throw new Error('Historical standings identity differs from requested season.');
      const saved = await persistCurrentSeason(year,
        driverSnapshot.standings.map(mapDriverStanding).filter(isRankedStanding).map((entry) => ({ ...entry.driver, code: entry.driver.code ?? '', position: entry.position, points: entry.points, wins: entry.wins })),
        teamSnapshot.standings.map(mapConstructorStanding).filter(isRankedStanding).map((entry) => ({ slug: entry.constructor.slug, name: entry.constructor.name, position: entry.position, points: entry.points, wins: entry.wins })),
        { driverRound: driverSnapshot.round, teamRound: teamSnapshot.round }, standingsObservation);
      job.bump({ itemsOut: saved.drivers + saved.teams });
      const [gap] = await getWorkerDb().select({ count: sql<number>`count(*)::int` }).from(schema.race).where(sql`${schema.race.seasonYear} = ${year} and ${schema.race.scheduleSourceState} = 'active' and ${schema.race.dateStart} < now() - interval '7 days' and not exists (select 1 from ${schema.result} res where res.race_id = ${schema.race.id})`);
      if ((gap?.count ?? 0) > 0) throw new Error(`Historical season ${year} has races without verified results; rerun required.`);
      await invalidateLocalJolpicaSeason(year);
      job.log(`season ${year} complete`);
    }
  });
}
main().finally(closeDb).catch(() => { console.error('Historical ingestion failed; inspect the durable ingestion run and rerun the requested range.'); process.exitCode = 1; });
