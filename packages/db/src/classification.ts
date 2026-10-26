import { and, eq, inArray, sql } from 'drizzle-orm';
import { predictionSourceVersion } from './predictions';
import { driver, team, race, result, qualifying, sprintResult, pitStop, lap, sourceSnapshotEvent } from './schema';
import { completeSourceObservation, fenceSourceObservation, validateSourceObservation, withSourceObservation, type DbTransaction, type SourceObservation } from './source-observation';

export interface ClassificationDriver {
  driverId: string; givenName: string; familyName: string; nationality?: string;
  permanentNumber?: string; code?: string; dateOfBirth?: string; url?: string;
}
export interface ClassificationConstructor { constructorId: string; name: string; nationality?: string; url?: string }
export interface ClassificationResult {
  position: string; positionText: string; points: string; laps?: string; status?: string; grid?: string; number?: string;
  Driver: ClassificationDriver; Constructor?: ClassificationConstructor;
  Time?: { millis?: string; time: string };
  FastestLap?: { rank: string; lap: string; Time: { time: string }; AverageSpeed?: { units: string; speed: string } };
}
export interface ClassificationQualifying {
  position: string; Driver: ClassificationDriver; Constructor?: ClassificationConstructor;
  Q1?: string; Q2?: string; Q3?: string;
}
export interface ClassificationPitStop { driverId: string; lap: string; time: string; duration: string; stop?: string }
export interface ClassificationLap { number: string; Timings: { driverId: string; position: string; time: string }[] }
/** Each supplied array is an entire strictly validated endpoint response, never one page or a cache fallback. */
export interface RaceClassificationSnapshotInput {
  season: number; round: number; results: ClassificationResult[]; qualifying: ClassificationQualifying[];
  sprintResults?: ClassificationResult[]; pitStops?: ClassificationPitStop[]; laps?: ClassificationLap[];
  /** Reserve BEFORE the uncached endpoint reads; the generation orders local attempts, not publisher revisions. */
  observation: SourceObservation;
}
type DriverValues = Pick<typeof driver.$inferInsert, 'slug' | 'firstName' | 'lastName' | 'fullName' | 'nationality' | 'permanentNumber' | 'code' | 'dob'>;
type TeamValues = Pick<typeof team.$inferInsert, 'slug' | 'name'>;
type ResultValues = Omit<typeof result.$inferInsert, 'raceId' | 'driverId' | 'teamId'> & { driverSlug: string; teamSlug: string | null };
type QualifyingValues = Omit<typeof qualifying.$inferInsert, 'raceId' | 'driverId'> & { driverSlug: string };
type SprintValues = Omit<typeof sprintResult.$inferInsert, 'raceId' | 'driverId'> & { driverSlug: string };
type PitValues = Omit<typeof pitStop.$inferInsert, 'raceId' | 'driverId'> & { driverSlug: string };
type LapValues = Omit<typeof lap.$inferInsert, 'raceId' | 'driverId'> & { driverSlug: string };
export interface ClassificationSnapshotPlan {
  drivers: DriverValues[]; teams: TeamValues[]; driverSlugs: string[];
  results: ResultValues[]; qualifying: QualifyingValues[]; sprintResults?: SprintValues[]; pitStops?: PitValues[]; laps?: LapValues[];
  contentHash: string;
}
export interface ClassificationSnapshotSummary {
  raceId: string; results: number; qualifying: number; sprintResults: number | null; pitStops: number | null; laps: number | null;
  removed: { results: string[]; qualifying: string[]; sprintResults: string[]; pitStops: string[]; laps: string[] };
}
const SOURCE = 'jolpica';
const RESULT_SOURCE = 'jolpica-single-entry';
const BATCH_SIZE = 500;
function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
}
function text(value: unknown, label: string, max = 160): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function slug(value: unknown, label: string): string {
  const valid = text(value, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(valid)) throw new Error(`Invalid ${label}.`);
  return valid;
}
function integer(value: unknown, label: string, min = 0, max = 1_000): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid ${label}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid ${label}.`);
  return number;
}
function decimal(value: unknown, label: string, max = 10_000): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid ${label}.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number > max) throw new Error(`Invalid ${label}.`);
  return number;
}
function timing(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}.`);
  const matched = /^(?:(\d{1,2}):)?(\d{1,2})\.(\d{1,3})$/.exec(value);
  if (!matched || Number(matched[2]) >= 60 || Number(matched[1] ?? '0') > 99) throw new Error(`Invalid ${label}.`);
  return (Number(matched[1] ?? '0') * 60 + Number(matched[2])) * 1_000 + Number(matched[3]!.padEnd(3, '0'));
}
/** Jolpica sends '' for a qualifying segment without a lap time; that is no time, not a malformed one. */
function segment(value: unknown, label: string): number | null {
  return value === undefined || value === '' ? null : timing(value, label);
}
function stopDuration(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?::\d{2}){0,2}(?:\.\d{1,3})?$/.test(value)) throw new Error('Invalid pit stop duration.');
  const [whole, fraction = ''] = value.split('.');
  const parts = whole!.split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some((part) => part >= 60)) throw new Error('Invalid pit stop duration.');
  const milliseconds = parts.reduce((seconds, part) => seconds * 60 + part, 0) * 1_000 + Number(fraction.padEnd(3, '0'));
  if (!Number.isSafeInteger(milliseconds) || milliseconds > 86_400_000) throw new Error('Invalid pit stop duration.');
  return milliseconds;
}
function optionalUrl(value: unknown, label: string): void {
  if (value === undefined) return;
  const parsed = new URL(text(value, label, 2_048));
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`Invalid ${label}.`);
}
function rows<T>(value: T[] | undefined, label: string, max: number, optional = false): T[] | undefined {
  if (optional && value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid complete ${label} snapshot.`);
  for (const row of value) if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid complete ${label} snapshot.`);
  return value;
}
function unique(keys: string[], label: string): void {
  if (new Set(keys).size !== keys.length) throw new Error(`Ambiguous duplicate ${label}; reviewed archive identities are required.`);
}

/** Pure boundary validation: malformed later rows cannot leave any earlier identity or result written. */
export function planRaceClassificationSnapshot(input: RaceClassificationSnapshotInput): ClassificationSnapshotPlan {
  object(input, 'classification snapshot');
  if (!Number.isInteger(input.season) || input.season < 1950 || input.season > new Date().getUTCFullYear() + 1 || !Number.isInteger(input.round) || input.round < 1 || input.round > 40) throw new Error('Invalid classification season or round.');
  object(input.observation, 'classification observation');
  validateSourceObservation(input.observation);
  if (input.observation.source !== SOURCE || input.observation.scope !== `classification:${input.season}:${input.round}`) throw new Error('Wrong classification observation scope.');
  const drivers = new Map<string, DriverValues>();
  const teams = new Map<string, TeamValues>();
  const referenced = new Set<string>();
  function addDriver(raw: ClassificationDriver): string {
    object(raw, 'driver identity');
    const driverSlug = slug(raw.driverId, 'driver ID');
    const firstName = text(raw.givenName, 'driver first name', 100);
    const lastName = text(raw.familyName, 'driver last name', 100);
    const nationality = raw.nationality === undefined ? '' : text(raw.nationality, 'driver nationality', 100);
    const code = raw.code === undefined ? undefined : text(raw.code, 'driver code', 8);
    if (code !== undefined && !/^[A-Za-z0-9]+$/.test(code)) throw new Error('Invalid driver code.');
    const permanentNumber = raw.permanentNumber === undefined ? undefined : integer(raw.permanentNumber, 'driver permanent number', 0, 999);
    let dob: string | undefined;
    if (raw.dateOfBirth !== undefined) {
      dob = text(raw.dateOfBirth, 'driver birth date', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(Date.parse(dob)) || new Date(dob).toISOString().slice(0, 10) !== dob || dob < '1800-01-01' || dob > new Date().toISOString().slice(0, 10)) throw new Error('Invalid driver birth date.');
    }
    optionalUrl(raw.url, 'driver URL');
    const candidate: DriverValues = { slug: driverSlug, firstName, lastName, fullName: `${firstName} ${lastName}`, nationality, ...(code === undefined ? {} : { code }), ...(permanentNumber === undefined ? {} : { permanentNumber }), ...(dob === undefined ? {} : { dob }) };
    const existing = drivers.get(driverSlug);
    if (existing) {
      for (const key of ['firstName', 'lastName', 'code', 'permanentNumber', 'dob', 'nationality'] as const) {
        const oldValue = existing[key]; const newValue = candidate[key];
        if (oldValue !== undefined && oldValue !== '' && newValue !== undefined && newValue !== '' && oldValue !== newValue) throw new Error(`Conflicting identity for driver ${driverSlug}.`);
      }
      drivers.set(driverSlug, { ...existing, ...candidate, nationality: nationality || existing.nationality });
    } else drivers.set(driverSlug, candidate);
    referenced.add(driverSlug);
    return driverSlug;
  }
  function addTeam(raw: ClassificationConstructor | undefined): string {
    object(raw, 'constructor identity');
    const teamSlug = slug(raw.constructorId, 'constructor ID');
    const name = text(raw.name, 'constructor name', 160);
    if (raw.nationality !== undefined) text(raw.nationality, 'constructor nationality', 100);
    optionalUrl(raw.url, 'constructor URL');
    if (teams.has(teamSlug) && teams.get(teamSlug)!.name !== name) throw new Error(`Conflicting identity for constructor ${teamSlug}.`);
    teams.set(teamSlug, { slug: teamSlug, name });
    return teamSlug;
  }
  function classification(raw: ClassificationResult, label: string): ResultValues {
    object(raw, label);
    const driverSlug = addDriver(raw.Driver); const teamSlug = raw.Constructor === undefined ? null : addTeam(raw.Constructor);
    const position = integer(raw.position, `${label} position`, 1, 100);
    const positionText = text(raw.positionText, `${label} position text`, 16);
    const points = decimal(raw.points, `${label} points`);
    const completedLaps = raw.laps === undefined ? null : integer(raw.laps, `${label} laps`, 0, 1_000);
    const grid = raw.grid === undefined ? null : integer(raw.grid, `${label} grid`, 0, 100);
    const status = raw.status === undefined ? 'Unknown' : text(raw.status, `${label} status`, 160);
    if (raw.number !== undefined) integer(raw.number, `${label} car number`, 0, 9_999);
    let timeMs: number | null = null; let gapToLeader: string | null = null;
    if (raw.Time !== undefined) {
      object(raw.Time, `${label} time`);
      // Jolpica sends Time { millis, time: '' } for some retired entries: keep the
      // provider milliseconds and store no display rather than rejecting the round.
      gapToLeader = raw.Time.time === '' ? null : text(raw.Time.time, `${label} time display`, 64);
      if (raw.Time.millis !== undefined) timeMs = integer(raw.Time.millis, `${label} time milliseconds`, 0, 86_400_000);
    }
    let fastestLapRank: number | null = null; let fastestLapTimeMs: number | null = null; let fastestLapLap: number | null = null;
    if (raw.FastestLap !== undefined) {
      object(raw.FastestLap, `${label} fastest lap`); object(raw.FastestLap.Time, `${label} fastest lap time`);
      fastestLapRank = integer(raw.FastestLap.rank, `${label} fastest lap rank`, 1, 100);
      fastestLapLap = integer(raw.FastestLap.lap, `${label} fastest lap number`, 1, 1_000);
      fastestLapTimeMs = timing(raw.FastestLap.Time.time, `${label} fastest lap time`);
      if (completedLaps !== null && fastestLapLap > completedLaps) throw new Error(`Invalid ${label} fastest lap number.`);
      if (raw.FastestLap.AverageSpeed !== undefined) {
        object(raw.FastestLap.AverageSpeed, `${label} fastest lap average speed`);
        text(raw.FastestLap.AverageSpeed.units, 'average speed units', 8); decimal(raw.FastestLap.AverageSpeed.speed, 'average speed', 1_000);
      }
    }
    return { source: RESULT_SOURCE, sourceEntryId: `${input.season}:${input.round}:${driverSlug}`, driverSlug, teamSlug, position, positionText, points, laps: completedLaps, grid, status, timeMs, gapToLeader, fastestLapRank, fastestLapTimeMs, fastestLapLap };
  }
  const resultRows = rows(input.results, 'results', 100)!.map((raw) => classification(raw, 'result'));
  unique(resultRows.map((row) => row.driverSlug), 'result driver');
  unique(resultRows.map((row) => String(row.position)), 'result position');
  const qualifyingRows = rows(input.qualifying, 'qualifying', 100)!.map((raw): QualifyingValues => {
    object(raw, 'qualifying result');
    const driverSlug = addDriver(raw.Driver);
    if (raw.Constructor !== undefined) addTeam(raw.Constructor);
    return { source: SOURCE, driverSlug, position: integer(raw.position, 'qualifying position', 1, 100), q1Ms: segment(raw.Q1, 'Q1 time'), q2Ms: segment(raw.Q2, 'Q2 time'), q3Ms: segment(raw.Q3, 'Q3 time') };
  });
  unique(qualifyingRows.map((row) => row.driverSlug), 'qualifying driver');
  unique(qualifyingRows.map((row) => String(row.position)), 'qualifying position');
  const sprintRows = rows(input.sprintResults, 'sprint results', 100, true)?.map((raw): SprintValues => {
    const converted = classification(raw, 'sprint result');
    return { source: SOURCE, driverSlug: converted.driverSlug, position: converted.position, points: converted.points, status: converted.status, timeMs: converted.timeMs };
  });
  if (sprintRows) { unique(sprintRows.map((row) => row.driverSlug), 'sprint driver'); unique(sprintRows.map((row) => String(row.position)), 'sprint position'); }
  const pitRows = rows(input.pitStops, 'pit stops', 2_000, true)?.map((raw): PitValues => {
    object(raw, 'pit stop');
    const driverSlug = slug(raw.driverId, 'pit stop driver ID'); referenced.add(driverSlug);
    const lapNumber = integer(raw.lap, 'pit stop lap', 1, 1_000);
    const timeOfDay = text(raw.time, 'pit stop time of day', 8);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(timeOfDay)) throw new Error('Invalid pit stop time of day.');
    if (raw.stop !== undefined) integer(raw.stop, 'pit stop sequence', 1, 100);
    return { source: SOURCE, driverSlug, lap: lapNumber, timeOfDay, durationMs: stopDuration(raw.duration) };
  });
  if (pitRows) unique(pitRows.map((row) => `${row.driverSlug}:${row.lap}`), 'pit stop driver/lap');
  const lapSnapshots = rows(input.laps, 'laps', 1_000, true);
  if (lapSnapshots) unique(lapSnapshots.map((raw) => String(integer(raw.number, 'lap number', 1, 1_000))), 'lap number');
  const lapRows = lapSnapshots?.flatMap((raw): LapValues[] => {
    object(raw, 'lap'); const lapNumber = integer(raw.number, 'lap number', 1, 1_000);
    const timings = rows(raw.Timings, 'lap timings', 100)!;
    if (!timings.length) throw new Error('A provided lap must have timings.');
    const converted = timings.map((item): LapValues => { const driverSlug = slug(item.driverId, 'lap driver ID'); referenced.add(driverSlug); return { source: SOURCE, driverSlug, lapNumber, position: integer(item.position, 'lap position', 1, 100), timeMs: timing(item.time, 'lap time') }; });
    unique(converted.map((row) => row.driverSlug), 'lap driver'); unique(converted.map((row) => String(row.position)), 'lap position');
    return converted;
  });
  if (lapRows) { if (lapRows.length > 12_000) throw new Error('Lap snapshot exceeds 12000 timings.'); unique(lapRows.map((row) => `${row.driverSlug}:${row.lapNumber}`), 'driver/lap'); }
  return { drivers: [...drivers.values()], teams: [...teams.values()], driverSlugs: [...referenced], results: resultRows, qualifying: qualifyingRows, sprintResults: sprintRows, pitStops: pitRows, laps: lapRows, contentHash: predictionSourceVersion(input.season, input.round, input.results, input.qualifying) };
}

function chunks<T>(values: T[]): T[][] { const output: T[][] = []; for (let i = 0; i < values.length; i += BATCH_SIZE) output.push(values.slice(i, i + BATCH_SIZE)); return output; }

/** One transaction applies all supplied classifications, identities, removals and their audit record. */
export async function persistRaceClassificationSnapshot(input: RaceClassificationSnapshotInput): Promise<ClassificationSnapshotSummary> {
  const plan = planRaceClassificationSnapshot(input);
  if (!process.env.DATABASE_URL) throw new Error('Classification persistence is not configured.');
  return withSourceObservation(input.observation, (tx) => applyClassificationSnapshot(tx, input, plan));
}

/** For callers already holding a real database transaction; never call with an unfenced/partial provider read. */
export async function persistRaceClassificationSnapshotInTransaction(tx: DbTransaction, input: RaceClassificationSnapshotInput): Promise<ClassificationSnapshotSummary> {
  const plan = planRaceClassificationSnapshot(input);
  await fenceSourceObservation(tx, input.observation);
  const applied = await applyClassificationSnapshot(tx, input, plan);
  await fenceSourceObservation(tx, input.observation);
  return applied;
}

async function applyClassificationSnapshot(tx: DbTransaction, input: RaceClassificationSnapshotInput, plan: ClassificationSnapshotPlan): Promise<ClassificationSnapshotSummary> {
  const weekends = await tx.select({ id: race.id, status: race.status }).from(race).where(and(eq(race.seasonYear, input.season), eq(race.round, input.round))).limit(1).for('update');
  const weekend = weekends[0]; if (!weekend) throw new Error('Classification race identity does not exist.');
  const weekendId = weekend.id;
  const driverRows = plan.driverSlugs.length ? await tx.select({ id: driver.id, slug: driver.slug }).from(driver).where(inArray(driver.slug, plan.driverSlugs)) : [];
  const driverIds = new Map(driverRows.map((row) => [row.slug, row.id]));
  const providedDrivers = new Set(plan.drivers.map((row) => row.slug));
  if (plan.driverSlugs.some((driverSlug) => !driverIds.has(driverSlug) && !providedDrivers.has(driverSlug))) throw new Error('A pit stop or lap references an unknown driver identity.');
  const incomingDriverIds = plan.results.map((row) => driverIds.get(row.driverSlug)).filter((id): id is string => Boolean(id));
  if (incomingDriverIds.length) {
    const collisions = await tx.select({ id: result.id }).from(result).where(and(eq(result.raceId, weekend.id), inArray(result.driverId, incomingDriverIds), sql`${result.source} <> ${RESULT_SOURCE}`)).limit(1);
    if (collisions.length) throw new Error('Existing result source ownership requires an explicit reviewed backfill.');
  }
  const removed: ClassificationSnapshotSummary['removed'] = { results: [], qualifying: [], sprintResults: [], pitStops: [], laps: [] };
  const allResults = await tx.select({ id: result.id, sourceEntryId: result.sourceEntryId, driverId: result.driverId }).from(result).where(and(eq(result.raceId, weekend.id), eq(result.source, RESULT_SOURCE))).limit(101);
  if (allResults.length > 100) throw new Error('Existing result snapshot exceeds the reviewed reconciliation bound.');
  if (!plan.results.length && allResults.length) throw new Error('Empty results cannot revoke an existing classification without reviewed official withdrawal evidence.');
  const resultKeys = new Set(plan.results.map((row) => row.sourceEntryId));
  const staleResultIds = allResults.filter((row) => !resultKeys.has(row.sourceEntryId)).map((row) => row.id);
  for (const batch of chunks(staleResultIds)) removed.results.push(...(await tx.delete(result).where(and(eq(result.raceId, weekend.id), eq(result.source, RESULT_SOURCE), inArray(result.id, batch))).returning({ id: result.id })).map((row) => row.id));
  for (const values of plan.drivers) {
    const update = { firstName: values.firstName, lastName: values.lastName, fullName: values.fullName, ...(values.nationality ? { nationality: values.nationality } : {}), ...(values.code === undefined ? {} : { code: values.code }), ...(values.permanentNumber === undefined ? {} : { permanentNumber: values.permanentNumber }), ...(values.dob === undefined ? {} : { dob: values.dob }), updatedAt: new Date() };
    const [saved] = await tx.insert(driver).values(values).onConflictDoUpdate({ target: driver.slug, set: update }).returning({ id: driver.id });
    if (!saved) throw new Error('Driver identity could not be persisted.'); driverIds.set(values.slug, saved.id);
  }
  const teamIds = new Map<string, string>();
  for (const values of plan.teams) {
    const [saved] = await tx.insert(team).values(values).onConflictDoUpdate({ target: team.slug, set: { name: values.name, updatedAt: new Date() } }).returning({ id: team.id });
    if (!saved) throw new Error('Constructor identity could not be persisted.'); teamIds.set(values.slug, saved.id);
  }
  const resultValues = plan.results.map(({ driverSlug, teamSlug, ...values }) => ({ ...values, raceId: weekend.id, driverId: driverIds.get(driverSlug)!, teamId: teamSlug === null ? null : teamIds.get(teamSlug)! }));
  for (const batch of chunks(resultValues)) {
    const changed = await tx.insert(result).values(batch).onConflictDoUpdate({ target: [result.source, result.sourceEntryId], set: { teamId: sql`excluded.team_id`, position: sql`excluded.position`, positionText: sql`excluded.position_text`, points: sql`excluded.points`, laps: sql`excluded.laps`, timeMs: sql`excluded.time_ms`, gapToLeader: sql`excluded.gap_to_leader`, status: sql`excluded.status`, grid: sql`excluded.grid`, fastestLapRank: sql`excluded.fastest_lap_rank`, fastestLapTimeMs: sql`excluded.fastest_lap_time_ms`, fastestLapLap: sql`excluded.fastest_lap_lap` }, setWhere: sql`${result.raceId} = excluded.race_id and ${result.driverId} = excluded.driver_id` }).returning({ id: result.id });
    if (changed.length !== batch.length) throw new Error('Result source entry belongs to another race or driver.');
  }
  async function reconcileNaturalTable(table: typeof qualifying | typeof sprintResult | typeof pitStop | typeof lap, values: Record<string, unknown>[], keyColumns: string[], updateColumns: string[], removedKey: Exclude<keyof ClassificationSnapshotSummary['removed'], 'results'>): Promise<void> {
    const tableName = table === qualifying ? 'qualifying' : table === sprintResult ? 'sprint_result' : table === pitStop ? 'pit_stop' : 'lap';
    // Only four fixed internal names/columns reach raw SQL; all provider values remain parameters.
    const identifier = sql.identifier(tableName);
    const maxStored = table === lap ? 24_000 : table === pitStop ? 4_000 : 500;
    const owned = await tx.execute(sql`select id, driver_id, ${keyColumns.includes('lap') ? sql`lap` : keyColumns.includes('lap_number') ? sql`lap_number` : sql`null as extra_key`}, source from ${identifier} where race_id = ${weekendId}::uuid limit ${maxStored + 1}`);
    if (owned.length > maxStored) throw new Error(`Existing ${tableName} snapshot exceeds the reviewed reconciliation bound.`);
    if (!values.length && owned.some((row) => row.source === SOURCE)) throw new Error(`Empty ${tableName} cannot revoke an existing dataset without reviewed official withdrawal evidence.`);
    const key = (row: Record<string, unknown>) => keyColumns.map((column) => String(row[column])).join(':');
    const incoming = new Set(values.map(key));
    for (const existing of owned) if (existing.source !== SOURCE && incoming.has(key(existing))) throw new Error(`Existing ${tableName} source ownership requires an explicit reviewed backfill.`);
    const staleIds = owned.filter((row) => row.source === SOURCE && !incoming.has(key(row))).map((row) => String(row.id));
    for (const batch of chunks(staleIds)) {
      const deleted = await tx.execute(sql`delete from ${identifier} where race_id = ${weekendId}::uuid and source = ${SOURCE} and id in (${sql.join(batch.map((id) => sql`${id}::uuid`), sql`, `)}) returning id`);
      removed[removedKey].push(...deleted.map((row) => String(row.id)));
    }
    for (const batch of chunks(values)) {
      const columns = Object.keys(batch[0]!);
      const valueRows = batch.map((row) => sql`(${sql.join(columns.map((column) => column === 'race_id' || column === 'driver_id' ? sql`${row[column]}::uuid` : sql`${row[column]}`), sql`, `)})`);
      const changed = await tx.execute(sql`insert into ${identifier} (${sql.join(columns.map((column) => sql.identifier(column)), sql`, `)}) values ${sql.join(valueRows, sql`, `)} on conflict (race_id, ${sql.join(keyColumns.map((column) => sql.identifier(column)), sql`, `)}) do update set ${sql.join(updateColumns.map((column) => sql`${sql.identifier(column)} = excluded.${sql.identifier(column)}`), sql`, `)} where ${identifier}.source = ${SOURCE} returning id`);
      if (changed.length !== batch.length) throw new Error(`Concurrent ${tableName} source ownership conflict.`);
    }
  }
  await reconcileNaturalTable(qualifying, plan.qualifying.map(({ driverSlug, ...values }) => ({ source: values.source, race_id: weekend.id, driver_id: driverIds.get(driverSlug)!, position: values.position, q1_ms: values.q1Ms, q2_ms: values.q2Ms, q3_ms: values.q3Ms })), ['driver_id'], ['position', 'q1_ms', 'q2_ms', 'q3_ms'], 'qualifying');
  if (plan.sprintResults !== undefined) await reconcileNaturalTable(sprintResult, plan.sprintResults.map(({ driverSlug, ...values }) => ({ source: values.source, race_id: weekend.id, driver_id: driverIds.get(driverSlug)!, position: values.position, points: values.points, status: values.status, time_ms: values.timeMs })), ['driver_id'], ['position', 'points', 'status', 'time_ms'], 'sprintResults');
  if (plan.pitStops !== undefined) await reconcileNaturalTable(pitStop, plan.pitStops.map(({ driverSlug, ...values }) => ({ source: values.source, race_id: weekend.id, driver_id: driverIds.get(driverSlug)!, lap: values.lap, time_of_day: values.timeOfDay, duration_ms: values.durationMs })), ['driver_id', 'lap'], ['time_of_day', 'duration_ms'], 'pitStops');
  if (plan.laps !== undefined) await reconcileNaturalTable(lap, plan.laps.map(({ driverSlug, ...values }) => ({ source: values.source, race_id: weekend.id, driver_id: driverIds.get(driverSlug)!, lap_number: values.lapNumber, position: values.position, time_ms: values.timeMs })), ['driver_id', 'lap_number'], ['position', 'time_ms'], 'laps');
  if (plan.results.length && weekend.status !== 'cancelled' && weekend.status !== 'testing') await tx.update(race).set({ status: 'completed', updatedAt: new Date() }).where(eq(race.id, weekend.id));
  const summary: ClassificationSnapshotSummary = { raceId: weekend.id, results: plan.results.length, qualifying: plan.qualifying.length, sprintResults: plan.sprintResults?.length ?? null, pitStops: plan.pitStops?.length ?? null, laps: plan.laps?.length ?? null, removed };
  await completeSourceObservation(tx, input.observation, plan.contentHash, { classification: { ...summary, removed: Object.fromEntries(Object.entries(removed).map(([key, ids]) => [key, ids.length])) } });
  await tx.insert(sourceSnapshotEvent).values({ source: input.observation.source, scope: input.observation.scope, generation: BigInt(input.observation.generation), observationId: input.observation.observationId, summary: { kind: 'classification', ...summary, contentHash: plan.contentHash } });
  return summary;
}
