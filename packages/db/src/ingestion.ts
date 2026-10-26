import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from './client';
import { boundedTransaction } from './bounded-transaction';
import { circuit, race, season, session, sourceSnapshotEvent, type NewResult } from './schema';
import { completeSourceObservation, withSourceObservation, type SourceObservation, type DbTransaction } from './source-observation';

export interface RaceScheduleInput {
  circuitId: string; circuitName: string; lat: number; lon: number; season: number; round: number;
  slug: string; name: string; country: string; city: string; wikiUrl?: string; circuitWikiUrl?: string; raceStartIso: string;
  sessions: { kind: string; iso: string }[];
}
const KINDS = new Set(['FP1', 'FP2', 'FP3', 'SQ', 'S', 'Q', 'R']);
function validateSchedule(input: RaceScheduleInput): void {
  if (!Number.isInteger(input.season) || input.season < 1950 || input.season > new Date().getUTCFullYear() + 1
    || !Number.isInteger(input.round) || input.round < 1 || input.round > 40 || !input.circuitId || !input.slug || !input.name
    || !Number.isFinite(Date.parse(input.raceStartIso)) || new Set(input.sessions.map((s) => s.kind)).size !== input.sessions.length
    || input.sessions.some((s) => !KINDS.has(s.kind) || !Number.isFinite(Date.parse(s.iso)))) throw new Error('Invalid race schedule.');
}

/** A calendar revision updates stable rows, preserving media and telemetry references. */
export async function persistRaceWeekend(input: RaceScheduleInput, observation?: SourceObservation): Promise<{ raceId: string }> {
  if (!process.env.DATABASE_URL) throw new Error('Schedule persistence is not configured.');
  validateSchedule(input);
  if (observation && (observation.source !== 'jolpica' || observation.scope !== `calendar:${input.season}`)) throw new Error('Wrong calendar observation scope.');
  return observation ? withSourceObservation(observation, (tx) => persistWeekendInTransaction(tx, input, observation)) : boundedTransaction(getDb(), (tx) => persistWeekendInTransaction(tx, input));
}
async function persistWeekendInTransaction(tx: DbTransaction, input: RaceScheduleInput, observation?: SourceObservation): Promise<{ raceId: string }> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar:${input.season}`}, 0))`);
    if (observation) {
      const existing = await tx.execute(sql`select r.slug, c.slug as circuit_slug from race r left join circuit c on c.id = r.circuit_id
        where r.season_year = ${input.season} and r.round = ${input.round} for update of r`);
      if (existing[0] && (existing[0].slug !== input.slug || existing[0].circuit_slug !== input.circuitId)) throw new Error('Calendar event identity changed; a reviewed round remapping is required.');
    }
    // Race and venue articles describe different entities. An absent venue URL
    // must preserve the existing venue source rather than use the race article.
    const circuitWiki = input.circuitWikiUrl?.trim() ? { wikiUrl: input.circuitWikiUrl } : {};
    const [venue] = await tx.insert(circuit).values({ slug: input.circuitId, name: input.circuitName, country: input.country, city: input.city, lat: Number.isFinite(input.lat) ? input.lat : null, lon: Number.isFinite(input.lon) ? input.lon : null, ...circuitWiki })
      .onConflictDoUpdate({ target: circuit.slug, set: { name: input.circuitName, country: input.country, city: input.city, lat: Number.isFinite(input.lat) ? input.lat : null, lon: Number.isFinite(input.lon) ? input.lon : null, ...circuitWiki, updatedAt: new Date() } }).returning({ id: circuit.id });
    if (!venue) throw new Error('Circuit identity could not be persisted.');
    const provenance = observation ? { scheduleSource: observation.source, scheduleSourceState: 'active' as const, scheduleObservationId: observation.observationId } : {};
    const values = { seasonYear: input.season, round: input.round, slug: input.slug, name: input.name, officialName: input.name, country: input.country, city: input.city, circuitId: venue.id, dateStart: new Date(input.raceStartIso), isSprint: input.sessions.some((s) => s.kind === 'S'), wikiUrl: input.wikiUrl, ...provenance };
    const [weekend] = await tx.insert(race).values({ ...values, status: 'upcoming' })
      // A past calendar timestamp alone is not an official finished classification.
      .onConflictDoUpdate({ target: [race.seasonYear, race.round], set: { ...values,
        // A date-only revision on the same UTC day cannot replace a known
        // race time with midnight. A changed date still updates the calendar.
        dateStart: /T\d{2}:\d{2}/.test(input.raceStartIso) ? values.dateStart : sql`case
          when (${race.dateStart} at time zone 'UTC')::date = (excluded.date_start at time zone 'UTC')::date
          then ${race.dateStart} else excluded.date_start end`,
        isSprint: input.sessions.some((s) => s.kind === 'S') ? true : sql`${race.isSprint}`,
        updatedAt: new Date() } }).returning({ id: race.id });
    if (!weekend) throw new Error('Race identity could not be persisted.');
    const timedSessions = input.sessions.filter((s) => /T\d{2}:\d{2}/.test(s.iso));
    if (timedSessions.length) {
      // Date-only upstream rows cannot overwrite a known time with synthetic midnight.
      await tx.insert(session).values(timedSessions.map((s) => ({ raceId: weekend.id, kind: s.kind as (typeof session.$inferInsert)['kind'], scheduledStart: new Date(s.iso), status: 'scheduled' as const, ...provenance })))
        .onConflictDoUpdate({ target: [session.raceId, session.kind], set: { scheduledStart: sql`excluded.scheduled_start`, ...provenance, updatedAt: new Date() } });
    }
    if (observation) {
      for (const item of input.sessions.filter((s) => !/T\d{2}:\d{2}/.test(s.iso))) {
        await tx.execute(sql`update session set schedule_source_state = 'unreported', schedule_observation_id = ${observation.observationId}::uuid,
          updated_at = clock_timestamp() where race_id = ${weekend.id}::uuid and kind = ${item.kind}
          and (scheduled_start at time zone 'UTC')::date <> ${item.iso}::date`);
      }
    }
    return { raceId: weekend.id };
}

/**
 * A season's status comes from its own complete calendar, never the clock
 * year: completed once the final round's race has run (3 h grace), active
 * once any race has run, otherwise upcoming.
 */
export function seasonStatusFromCalendar(inputs: Pick<RaceScheduleInput, 'raceStartIso'>[], now = Date.now()): 'completed' | 'active' | 'upcoming' {
  const starts = inputs.map((input) => Date.parse(input.raceStartIso)).filter(Number.isFinite);
  if (!starts.length) return 'upcoming';
  const done = (start: number) => start + 3 * 3_600_000 <= now;
  if (done(Math.max(...starts))) return 'completed';
  return starts.some(done) ? 'active' : 'upcoming';
}

/** Complete strict calendar only. Removed rows retain IDs and linked metadata. */
/** A calendar identical to the last applied one (and its derived season status) is not rewritten, except weekly. */
export const CALENDAR_FULL_WRITE_INTERVAL_MS = 7 * 86_400_000;
export function calendarContentHash(year: number, inputs: RaceScheduleInput[], status: string): string {
  const rows = [...inputs].sort((a, b) => a.round - b.round);
  return createHash('sha256').update(JSON.stringify({ version: 1, year, status, rows })).digest('hex');
}

export async function reconcileRaceCalendar(year: number, inputs: RaceScheduleInput[], observation: SourceObservation): Promise<{ racesPersisted: number; sessionsScheduled: number; withdrawnRaces: number; withdrawnSessions: number; calendarUnchanged?: number }> {
  if (!inputs.length || inputs.length > 40 || inputs.some((input) => input.season !== year) || new Set(inputs.map((input) => input.round)).size !== inputs.length) throw new Error('A complete valid calendar is required.');
  inputs.forEach(validateSchedule);
  if (observation.source !== 'jolpica' || observation.scope !== `calendar:${year}`) throw new Error('Wrong calendar observation scope.');
  return withSourceObservation(observation, async (tx) => {
    const status = seasonStatusFromCalendar(inputs);
    const contentHash = calendarContentHash(year, inputs, status);
    // Equality only (never "newer"): same validated calendar, same status, a
    // full write within the week -> record the observation, skip ~150 writes.
    const [stored] = await tx.execute(sql`select content_hash, details->>'calendarFullWriteAt' as "fullWriteAt" from source_snapshot
      where source = ${observation.source} and scope = ${observation.scope}`);
    const lastFull = Date.parse(String(stored?.fullWriteAt ?? ''));
    if (stored?.content_hash === contentHash && Number.isFinite(lastFull) && Date.now() - lastFull < CALENDAR_FULL_WRITE_INTERVAL_MS) {
      const unchanged = { racesPersisted: 0, sessionsScheduled: 0, withdrawnRaces: 0, withdrawnSessions: 0, calendarUnchanged: 1 };
      await completeSourceObservation(tx, observation, contentHash, { calendarUnchanged: true });
      return unchanged;
    }
    await tx.insert(season).values({ year, status }).onConflictDoUpdate({ target: season.year, set: { status, updatedAt: new Date() } });
    for (const input of inputs) await persistWeekendInTransaction(tx, input, observation);
    const withdrawn = await tx.execute(sql`update race set schedule_source_state = 'withdrawn', schedule_observation_id = ${observation.observationId}::uuid,
      updated_at = clock_timestamp() where season_year = ${year} and schedule_source = ${observation.source}
      and round <> all(ARRAY[${sql.join(inputs.map((input) => sql`${input.round}`), sql`, `)}]::int[]) and schedule_source_state <> 'withdrawn' returning id`);
    let withdrawnSessions = 0;
    for (const input of inputs) {
      // Optional session fields are not an authoritative cancellation inventory.
      const rows = await tx.execute(sql`update session s set schedule_source_state = 'unreported', schedule_observation_id = ${observation.observationId}::uuid,
        updated_at = clock_timestamp() from race r where r.id = s.race_id and r.season_year = ${year} and r.round = ${input.round}
        and s.schedule_source = ${observation.source} and s.kind <> all(ARRAY[${sql.join(input.sessions.map((item) => sql`${item.kind}`), sql`, `)}]::text[])
        and s.schedule_source_state <> 'unreported' returning s.id`);
      withdrawnSessions += rows.length;
    }
    const summary = { racesPersisted: inputs.length, sessionsScheduled: inputs.flatMap((input) => input.sessions).filter((item) => /T\d{2}:\d{2}/.test(item.iso)).length, withdrawnRaces: withdrawn.length, withdrawnSessions };
    await completeSourceObservation(tx, observation, contentHash, { ...summary, calendarUnchanged: false, calendarFullWriteAt: new Date().toISOString() });
    await tx.insert(sourceSnapshotEvent).values({ ...observation, generation: BigInt(observation.generation), summary: { ...summary, withdrawnRaceIds: withdrawn.map((row) => row.id) } });
    return summary;
  });
}

/** Cancellation needs an explicit authoritative statement, not an omitted field. */
export async function applySessionCancellation(input: { raceId: string; kind: typeof session.$inferInsert['kind']; sourceUrl: string; observedAt: Date }, observation: SourceObservation): Promise<boolean> {
  const url = new URL(input.sourceUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(fia\.com|formula1\.com)$/.test(url.hostname)
    || !Number.isFinite(input.observedAt.getTime()) || input.observedAt.getTime() > Date.now() + 300_000) throw new Error('Explicit cancellation provenance is required.');
  if (observation.scope !== `session:${input.raceId}:${input.kind}`) throw new Error('Wrong cancellation observation scope.');
  return withSourceObservation(observation, async (tx) => {
    const weekends = await tx.execute(sql`select season_year from race where id=${input.raceId}::uuid`);
    if (!weekends[0]) return false;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`calendar:${String(weekends[0].season_year)}`}, 0))`);
    const rows = await tx.update(session).set({ status: 'cancelled', statusSourceUrl: input.sourceUrl, statusSourceObservedAt: input.observedAt, updatedAt: new Date() })
      .where(sql`${session.raceId} = ${input.raceId}::uuid and ${session.kind} = ${input.kind}
        and ${session.status} = 'scheduled' and ${session.actualStart} is null and ${session.actualEnd} is null`).returning({ id: session.id });
    await completeSourceObservation(tx, observation, null, { explicitCancellation: true, sessionIds: rows.map((row) => row.id), sourceUrl: input.sourceUrl });
    return rows.length === 1;
  });
}

/** Only a verified classification can advance a persisted race to completed. */
export async function markRaceClassificationComplete(raceId: string): Promise<void> {
  await getDb().update(race).set({ status: 'completed', updatedAt: new Date() }).where(eq(race.id, raceId));
}

/** Jolpica omits source row IDs: only unambiguous single-entry driver races qualify. */
export function jolpicaResultIdentity(season: number, round: number, driverIds: string[]): Map<string, Pick<NewResult, 'source' | 'sourceEntryId'>> {
  if (!Number.isInteger(season) || !Number.isInteger(round) || driverIds.some((id) => !id) || new Set(driverIds).size !== driverIds.length) {
    throw new Error('Ambiguous historical result entries require reviewed archive source IDs; ingestion stopped without dropping entries.');
  }
  return new Map(driverIds.map((id) => [id, { source: 'jolpica-single-entry', sourceEntryId: `${season}:${round}:${id}` }]));
}
