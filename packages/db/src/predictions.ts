import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getDb, type Db } from './client';
import { boundedTransaction } from './bounded-transaction';
import { prediction, type PredictionPicks } from './schema';
import { scorePicks, type ScoringRaceResult, type ScoringQualifyingResult } from './prediction-scoring';
import { withSourceObservation, completeSourceObservation, type SourceObservation, type DbTransaction } from './source-observation';

const hasDb = () => Boolean(process.env.DATABASE_URL);
export interface UpsertPredictionInput { clientId: string; handle?: string | null; season: number; round: number; raceSlug: string; picks: PredictionPicks; lockAt: Date }

/** The database clock rechecks the canonical deadline on both insert and conflict. */
export async function upsertPrediction(input: UpsertPredictionInput): Promise<boolean> {
  if (!hasDb()) throw new Error('Prediction persistence is not configured.');
  if (!Number.isFinite(input.lockAt.getTime())) throw new Error('Invalid prediction deadline.');
  try {
    const rows = await getDb().execute(sql`
      insert into prediction (client_id, handle, season, round, race_slug, picks, updated_at)
      select ${input.clientId}, ${input.handle ?? null}, ${input.season}, ${input.round},
        ${input.raceSlug}, ${JSON.stringify(input.picks)}::jsonb, clock_timestamp()
      where clock_timestamp() < ${input.lockAt.toISOString()}::timestamptz
      on conflict (client_id, season, round) do update
      set picks = excluded.picks, handle = excluded.handle, race_slug = excluded.race_slug, updated_at = clock_timestamp()
      where prediction.score is null and prediction.scored_at is null
        and clock_timestamp() < ${input.lockAt.toISOString()}::timestamptz returning id
    `);
    return rows.length > 0;
  } catch (cause) { throw new Error('Failed to persist prediction.', { cause }); }
}

export async function getPrediction(clientId: string, season: number, round: number): Promise<{ picks: PredictionPicks; score: number | null; revision: string } | null> {
  if (!hasDb()) return null;
  try {
    const rows = await getDb().select({ picks: prediction.picks, score: sql<number | null>`case when exists
      (select 1 from source_snapshot s where s.source='jolpica' and s.scope='classification:' || ${prediction.season}::text || ':' || ${prediction.round}::text
        and s.content_hash=${prediction.scoreSourceVersion}) then ${prediction.score} else null end`, revision: sql<string>`${prediction.updatedAt}::text` }).from(prediction)
      .where(and(eq(prediction.clientId, clientId), eq(prediction.season, season), eq(prediction.round, round))).limit(1);
    return rows[0] ?? null;
  } catch (cause) { throw new Error('Failed to read prediction.', { cause }); }
}

export type PredictionAttemptInput = UpsertPredictionInput & { attemptId: string; expectedRevision?: string | null };
export interface PredictionAttemptOutcome { kind: 'applied' | 'replayed' | 'conflict' | 'locked'; current: boolean; revision: string | null }
function predictionAttemptContentHash(input: Pick<UpsertPredictionInput, 'handle' | 'season' | 'round' | 'raceSlug' | 'picks'>): string {
  return createHash('sha256').update(JSON.stringify({ handle: input.handle ?? null, season: input.season, round: input.round, raceSlug: input.raceSlug,
    picks: Object.fromEntries(Object.entries(input.picks).sort(([a], [b]) => a.localeCompare(b))) })).digest('hex');
}
export function predictionAttemptPayloadHash(input: Pick<PredictionAttemptInput, 'handle' | 'season' | 'round' | 'raceSlug' | 'picks' | 'expectedRevision'>): string {
  return createHash('sha256').update(JSON.stringify({ handle: input.handle ?? null, season: input.season, round: input.round, raceSlug: input.raceSlug,
    picks: Object.fromEntries(Object.entries(input.picks).sort(([a], [b]) => a.localeCompare(b))),
    expectedRevision: input.expectedRevision === undefined ? { unconditional: true } : input.expectedRevision })).digest('hex');
}
export interface PredictionAttemptReceipt { confirmed: boolean; outcome: 'applied' | 'conflict' | 'locked'; current: boolean; revision: string | null; payloadHash: string }
export async function getPredictionAttemptReceipt(input: { clientId: string; season: number; round: number; attemptId: string }): Promise<PredictionAttemptReceipt | null> {
  if (!hasDb()) throw new Error('Prediction persistence is not configured.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.attemptId)) throw new Error('Invalid prediction attempt.');
  const rows = await getDb().execute(sql`select a.outcome, a.prediction_revision, a.payload_hash, a.content_hash,
    p.picks, p.handle, p.race_slug, p.updated_at::text as current_revision from prediction_attempt a
    left join prediction p on p.client_id = a.client_id and p.season = a.season and p.round = a.round
    where a.client_id = ${input.clientId} and a.season = ${input.season} and a.round = ${input.round} and a.attempt_id = ${input.attemptId}::uuid limit 1`);
  const row = rows[0];
  if (!row) return null;
  const currentHash = row.picks ? predictionAttemptContentHash({ season: input.season, round: input.round, raceSlug: String(row.race_slug), handle: row.handle as string | null, picks: row.picks as PredictionPicks }) : null;
  return { confirmed: row.outcome === 'applied', outcome: row.outcome as PredictionAttemptReceipt['outcome'], current: row.outcome === 'applied' && currentHash === row.content_hash,
    revision: row.current_revision ? String(row.current_revision) : null, payloadHash: String(row.payload_hash) };
}
/** Serializes one actor/race; a replay confirms an earlier write without redoing it. */
export async function savePredictionAttempt(input: PredictionAttemptInput): Promise<PredictionAttemptOutcome> {
  if (!hasDb()) throw new Error('Prediction persistence is not configured.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.attemptId)
    || !input.clientId || !Number.isInteger(input.season) || !Number.isInteger(input.round) || !Number.isFinite(input.lockAt.getTime())
    || (input.expectedRevision !== undefined && input.expectedRevision !== null && !Number.isFinite(Date.parse(input.expectedRevision)))) throw new Error('Invalid prediction attempt.');
  const payloadHash = predictionAttemptPayloadHash(input);
  const contentHash = predictionAttemptContentHash(input);
  return boundedTransaction(getDb(), async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.clientId}:${input.season}:${input.round}`}, 0))`);
    const receipts = await tx.execute(sql`select payload_hash, content_hash, outcome, prediction_revision from prediction_attempt
      where client_id = ${input.clientId} and season = ${input.season} and round = ${input.round} and attempt_id = ${input.attemptId}::uuid`);
    const existing = await tx.execute(sql`select picks, handle, race_slug, updated_at::text as revision, score, scored_at from prediction
      where client_id = ${input.clientId} and season = ${input.season} and round = ${input.round} for update`);
    const current = existing[0];
    const receipt = receipts[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) return { kind: 'conflict', current: false, revision: current ? String(current.revision) : null };
      if (receipt.outcome !== 'applied') return { kind: receipt.outcome as 'conflict' | 'locked', current: false, revision: receipt.prediction_revision ? String(receipt.prediction_revision) : null };
      const currentHash = current ? predictionAttemptContentHash({ season: input.season, round: input.round, raceSlug: String(current.race_slug), handle: current.handle as string | null, picks: current.picks as PredictionPicks }) : null;
      return { kind: 'replayed', current: currentHash === receipt.content_hash, revision: current ? String(current.revision) : null };
    }
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${`calendar:${input.season}`}, 0))`);
    const canonical = await tx.execute(sql`select r.slug, r.schedule_source_state, r.status,
      q.scheduled_start::text as qualifying_deadline, q.schedule_source_state as qualifying_source_state,
      q.status as qualifying_status, q.actual_start as qualifying_actual_start
      from race r left join session q on q.race_id = r.id and q.kind='Q'
      where r.season_year = ${input.season} and r.round = ${input.round}`);
    if (canonical[0]?.slug !== input.raceSlug) throw new Error('Prediction race identity is not canonical.');
    const conflict = input.expectedRevision !== undefined && (current ? current.revision !== input.expectedRevision : input.expectedRevision !== null);
    if (!['cancelled','completed'].includes(String(canonical[0]?.status)) && canonical[0]?.schedule_source_state !== 'withdrawn'
      && (!canonical[0]?.qualifying_deadline || canonical[0]?.qualifying_source_state !== 'active' || canonical[0]?.qualifying_status === 'cancelled')) {
      throw new Error('Canonical prediction deadline is unavailable.');
    }
    let outcome: 'applied' | 'conflict' | 'locked' = conflict ? 'conflict' : 'locked';
    let revision = current ? String(current.revision) : null;
    const canonicalDeadline = canonical[0]?.qualifying_deadline;
    const lockAt = canonicalDeadline && Date.parse(String(canonicalDeadline)) < input.lockAt.getTime() ? new Date(String(canonicalDeadline)) : input.lockAt;
    if (!conflict && canonical[0]?.schedule_source_state !== 'withdrawn' && !['cancelled','completed'].includes(String(canonical[0]?.status))
      && !['live','completed'].includes(String(canonical[0]?.qualifying_status)) && !canonical[0]?.qualifying_actual_start) {
      const changed = await tx.execute(sql`insert into prediction (client_id, handle, season, round, race_slug, picks, updated_at)
        select ${input.clientId}, ${input.handle ?? null}, ${input.season}, ${input.round}, ${input.raceSlug}, ${JSON.stringify(input.picks)}::jsonb, clock_timestamp()
        where clock_timestamp() < ${lockAt.toISOString()}::timestamptz
        on conflict (client_id, season, round) do update set picks = excluded.picks, handle = excluded.handle,
          race_slug = excluded.race_slug, updated_at = clock_timestamp()
        where prediction.score is null and prediction.scored_at is null and clock_timestamp() < ${lockAt.toISOString()}::timestamptz
        returning updated_at::text as revision`);
      if (changed[0]) { outcome = 'applied'; revision = String(changed[0].revision); }
    }
    await tx.execute(sql`insert into prediction_attempt (client_id, season, round, attempt_id, payload_hash, content_hash, outcome, prediction_revision)
      values (${input.clientId}, ${input.season}, ${input.round}, ${input.attemptId}::uuid, ${payloadHash}, ${contentHash}, ${outcome}, ${revision})`);
    return { kind: outcome, current: outcome === 'applied', revision };
  });
}

export interface Consensus { total: number; questions: Record<string, { value: string; count: number; pct: number }[]> }
/** Aggregate inside PostgreSQL; no download of every fan's picks to the application. */
export async function getConsensus(season: number, round: number): Promise<Consensus> {
  if (!hasDb()) return { total: 0, questions: {} };
  try {
    const rows = await getDb().execute(sql`
      with race_predictions as (select picks from prediction where season = ${season} and round = ${round}),
      choices as (
        select e.key as question, e.value #>> '{}' as value from race_predictions
        cross join lateral jsonb_each(case when jsonb_typeof(picks) = 'object' then picks else '{}'::jsonb end) e
        where e.key in ('pole', 'winner', 'podium', 'fastest_lap') and jsonb_typeof(e.value) = 'string'
          and length(e.value #>> '{}') between 1 and 64
      )
      select (select count(*)::int from race_predictions) as total, coalesce(jsonb_agg(grouped), '[]'::jsonb) as choices
      from (select question, value, count(*)::int as count from choices group by question, value) grouped
    `);
    const tally: Record<string, Record<string, number>> = Object.create(null) as Record<string, Record<string, number>>;
    for (const choice of (rows[0]?.choices ?? []) as { question: string; value: string; count: number }[]) {
      (tally[choice.question] ??= Object.create(null) as Record<string, number>)[choice.value] = choice.count;
    }
    const questions: Consensus['questions'] = {};
    for (const [question, counts] of Object.entries(tally)) {
      const sum = Object.values(counts).reduce((a, b) => a + b, 0);
      questions[question] = Object.entries(counts).map(([value, count]) => ({ value, count, pct: Math.round(count / sum * 100) })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return { total: Number(rows[0]?.total ?? 0), questions };
  } catch (cause) { throw new Error('Failed to read prediction consensus.', { cause }); }
}

export interface LeaderRow { clientId: string; handle: string | null; total: number; races: number }
export async function getLeaderboard(season: number, limit = 10): Promise<LeaderRow[]> {
  if (!hasDb()) return [];
  try {
    const rows = await getDb().select({ clientId: prediction.clientId,
      handle: sql<string | null>`(array_agg(${prediction.handle} order by ${prediction.updatedAt} desc) filter (where ${prediction.handle} is not null))[1]`,
      total: sql<number>`coalesce(sum(${prediction.score}),0)::int`, races: sql<number>`count(*)::int`,
    }).from(prediction).where(and(eq(prediction.season, season), isNotNull(prediction.score), sql`exists
      (select 1 from source_snapshot s where s.source='jolpica' and s.scope='classification:' || ${prediction.season}::text || ':' || ${prediction.round}::text
        and s.content_hash=${prediction.scoreSourceVersion})`)).groupBy(prediction.clientId)
      .orderBy(desc(sql`coalesce(sum(${prediction.score}),0)`), prediction.clientId).limit(Math.max(1, Math.min(100, Math.trunc(limit) || 10)));
    return rows.map((r) => ({ ...r, total: Number(r.total), races: Number(r.races) }));
  } catch (cause) { throw new Error('Failed to read prediction leaderboard.', { cause }); }
}

export interface RacePrediction { id: string; clientId: string; picks: PredictionPicks; score: number | null; updatedAt: string; scoreSourceVersion: string | null }
export async function getRacePredictions(season: number, round: number, options: { afterId?: string; limit?: number } = {}): Promise<RacePrediction[]> {
  if (!hasDb()) throw new Error('Prediction scoring is not configured.');
  try {
    return await readPredictionPage(getDb(), season, round, options);
  } catch (cause) { throw new Error('Failed to read race predictions.', { cause }); }
}
async function readPredictionPage(db: Db | DbTransaction, season: number, round: number, options: { afterId?: string; limit?: number; sourceVersion?: string }): Promise<RacePrediction[]> {
    const limit = options.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > 501 || (options.afterId && !/^[0-9a-f-]{36}$/i.test(options.afterId))) throw new Error('Invalid prediction page.');
    return db.select({ id: prediction.id, clientId: prediction.clientId, picks: prediction.picks, score: prediction.score,
      // PostgreSQL microseconds must survive the optimistic concurrency check.
      updatedAt: sql<string>`${prediction.updatedAt}::text`, scoreSourceVersion: prediction.scoreSourceVersion,
    }).from(prediction).where(and(eq(prediction.season, season), eq(prediction.round, round), options.afterId ? gt(prediction.id, options.afterId) : undefined,
      options.sourceVersion ? sql`${prediction.scoreSourceVersion} IS DISTINCT FROM ${options.sourceVersion}` : undefined)).orderBy(prediction.id).limit(limit);
}

export interface PredictionScoreUpdate { id: string; score: number; expectedPicks: PredictionPicks; expectedUpdatedAt: string; expectedScoreSourceVersion: string | null; sourceVersion: string }
export async function setPredictionScores(updates: PredictionScoreUpdate[]): Promise<number> {
  if (!hasDb()) throw new Error('Prediction scoring is not configured.');
  if (!updates.length) return 0;
  if (updates.length > 500) throw new Error('Prediction score writes are bounded to 500 participants.');
  for (const update of updates) {
    if (!Number.isInteger(update.score) || update.score < 0 || update.score > 13 || !update.sourceVersion || !Number.isFinite(Date.parse(update.expectedUpdatedAt))
      || (update.expectedScoreSourceVersion !== null && (typeof update.expectedScoreSourceVersion !== 'string' || !update.expectedScoreSourceVersion.trim()))) throw new Error('Invalid prediction score.');
  }
  return boundedTransaction(getDb(), (tx) => applyScores(tx, updates));
}
async function applyScores(tx: DbTransaction, updates: PredictionScoreUpdate[]): Promise<number> {
    let count = 0;
    for (let start = 0; start < updates.length; start += 500) {
      const values = updates.slice(start, start + 500).map((u) => sql`(${u.id}::uuid, ${u.score}::integer, ${JSON.stringify(u.expectedPicks)}::jsonb, ${u.expectedUpdatedAt}::text::timestamptz, ${u.expectedScoreSourceVersion}::text, ${u.sourceVersion}::text)`);
      const changed = await tx.execute(sql`update prediction p set score = v.score, scored_at = clock_timestamp(), score_source_version = v.version
        from (values ${sql.join(values, sql`, `)}) as v(id, score, picks, updated_at, previous_version, version)
        where p.id = v.id and p.updated_at = v.updated_at and p.picks = v.picks
          and p.score_source_version IS NOT DISTINCT FROM v.previous_version returning p.id`);
      count += changed.length;
    }
    return count;
}

/** Includes scored races so changed official classifications can be reconciled. */
export async function listPredictionRaces(season: number): Promise<{ season: number; round: number }[]> {
  if (!hasDb()) throw new Error('Prediction scoring is not configured.');
  return getDb().selectDistinct({ season: prediction.season, round: prediction.round }).from(prediction).where(eq(prediction.season, season));
}

/** Equality fingerprint only: never evidence that a publisher revision is newer. */
export function predictionSourceVersion(season: number, round: number, results: ScoringRaceResult[], qualifying: ScoringQualifyingResult[]): string {
  const normalize = <T extends { Driver: { driverId: string }; position: string }>(rows: T[]) => [...rows].sort((a, b) => a.Driver.driverId.localeCompare(b.Driver.driverId) || a.position.localeCompare(b.position));
  return createHash('sha256').update(JSON.stringify({ version: 1, season, round,
    results: normalize(results).map((r) => [r.Driver.driverId, r.position, r.FastestLap?.rank ?? null]), qualifying: normalize(qualifying).map((q) => [q.Driver.driverId, q.position]),
  })).digest('hex');
}
export interface PredictionGradingOptions { observation: SourceObservation; afterId?: string | null; batchSize?: number }
export interface PredictionGradingPage { graded: number; pending: number; conflicted: number; nextCursor: string | null; complete: boolean; deferred: number }
/** At most 500 participants, same accepted snapshot and lease throughout commit. */
export async function scorePendingPredictionsForRace(season: number, round: number, results: ScoringRaceResult[], qualifying: ScoringQualifyingResult[], options?: PredictionGradingOptions): Promise<PredictionGradingPage> {
  if (!hasDb()) throw new Error('Prediction scoring is not configured.');
  if (!options?.observation || options.observation.source !== 'jolpica' || options.observation.scope !== `classification:${season}:${round}`) throw new Error('An accepted classification observation is required for grading.');
  const batchSize = options.batchSize ?? 500;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500 || results.length > 100 || qualifying.length > 100) throw new Error('Invalid prediction grading page.');
  const sourceVersion = predictionSourceVersion(season, round, results, qualifying);
  return withSourceObservation(options.observation, async (tx) => {
    const states = await tx.execute(sql`select content_hash, applied_observation_id::text, details from source_snapshot
      where source = ${options.observation.source} and scope = ${options.observation.scope}`);
    const state = states[0];
    if (!state || state.content_hash !== sourceVersion || state.applied_observation_id !== options.observation.observationId) throw new Error('Classification inputs do not match the accepted stored snapshot.');
    const totals = async () => {
      const rows = await tx.execute(sql`select count(*) filter (where score is null)::int as pending,
        count(*) filter (where score_source_version IS DISTINCT FROM ${sourceVersion})::int as deferred
        from prediction where season = ${season} and round = ${round}`);
      return { pending: Number(rows[0]?.pending ?? 0), deferred: Number(rows[0]?.deferred ?? 0) };
    };
    if (!scorePicks({}, results, qualifying)) return { graded: 0, ...(await totals()), conflicted: 0, nextCursor: null, complete: false };
    const details = state.details as Record<string, unknown> | undefined;
    const persistedCursor = details?.gradingFingerprint === sourceVersion && typeof details.gradingAfterId === 'string' ? details.gradingAfterId : undefined;
    const cursor = options.afterId === null ? undefined : options.afterId ?? persistedCursor;
    const page = await readPredictionPage(tx, season, round, { afterId: cursor, limit: batchSize + 1, sourceVersion });
    const selected = page.slice(0, batchSize);
    const updates = selected.map((p) => ({ id: p.id, score: scorePicks(p.picks, results, qualifying)!.total, expectedPicks: p.picks, expectedUpdatedAt: p.updatedAt, expectedScoreSourceVersion: p.scoreSourceVersion, sourceVersion }));
    const graded = await applyScores(tx, updates);
    const counts = await totals();
    const nextCursor = page.length > batchSize ? selected.at(-1)!.id : null;
    await completeSourceObservation(tx, options.observation, sourceVersion, { gradingFingerprint: sourceVersion, gradingAfterId: nextCursor });
    return { graded, ...counts, conflicted: updates.length - graded, nextCursor, complete: counts.deferred === 0 };
  });
}
