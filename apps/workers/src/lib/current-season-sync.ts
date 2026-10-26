import { jolpica, mapRace, mapDriverStanding, mapConstructorStanding, isRankedStanding, type UiRace, type FetchOpts } from '@apex/api-client/jolpica';
import {
  beginSourceObservation, reconcileRaceCalendar, persistCurrentSeason,
  listPredictionRaces, persistRaceClassificationSnapshot, scorePendingPredictionsForRace, listClassifiedRounds,
} from '@apex/db';
import { JobBudgetError, type JobContext } from './job-control';
import { describeError } from './describe-error';

export const currentSeasonOperations = {
  begin: beginSourceObservation, calendar: reconcileRaceCalendar, standings: persistCurrentSeason,
  races: listPredictionRaces, classification: persistRaceClassificationSnapshot, grade: scorePendingPredictionsForRace,
  /** Rounds already holding a stored classification, so missing rounds are filled first. */
  classified: listClassifiedRounds,
  schedule: jolpica.getSchedule, drivers: jolpica.getDriverStandingsSnapshot, teams: jolpica.getConstructorStandingsSnapshot,
  results: jolpica.getRaceResults, qualifying: jolpica.getQualifyingFull, sprint: jolpica.getSprint,
};
type Operations = typeof currentSeasonOperations;
/** Known control messages are kept; anything else is a generic line plus the redacted error class (R3-BE-2). */
export const errorMessage = (error: unknown) => error instanceof Error && /superseded|expired|ownership|budget|incomplete|identity/i.test(error.message)
  ? error.message.slice(0, 200) : `Provider or persistence operation failed; previous verified data was retained. Cause: ${describeError(error)}`;

/**
 * Which finished rounds to (re)read this run, newest first:
 *  1. the two most recent finished rounds (late penalties and corrections),
 *  2. then rounds with no stored classification yet (a fresh database fills
 *     its season in a few bounded runs rather than by chance),
 *  3. then a daily rotation through at most two already stored rounds (all of
 *     them for a full operator run, maximum 40), so a complete season costs a
 *     handful of reads and never starves the next one.
 * Without `classified` (progress unknown) steps 2 and 3 are one rotation.
 */
export function selectClassificationRounds(races: UiRace[], candidateRounds: number[], maximum = 4, now = Date.now(), classified?: ReadonlySet<number>): number[] {
  const rounds = candidateRounds.filter((round) => races.some((race) => race.round === round && Date.parse(race.raceStartIso) + 3 * 3_600_000 < now)).sort((a, b) => b - a);
  if (!classified && rounds.length <= maximum) return rounds;
  const selected = rounds.slice(0, Math.min(2, maximum));
  const rest = rounds.slice(selected.length);
  const missing = classified ? rest.filter((round) => !classified.has(round)) : [];
  for (const round of missing) if (selected.length < maximum) selected.push(round);
  const historical = rest.filter((round) => !selected.includes(round));
  if (!historical.length) return selected;
  // A full operator run (maximum 40) re-checks everything; scheduled runs rotate two.
  const limit = classified && maximum < 40 ? Math.min(maximum, selected.length + 2) : maximum;
  const rotation = Math.floor(now / 86_400_000) % historical.length;
  for (let offset = 0; selected.length < limit && offset < historical.length; offset++) selected.push(historical[(rotation + offset) % historical.length]!);
  return selected;
}

/** Uncached, strict provider reads bounded by the job's remaining budget. */
export function jobReadOptions(job: JobContext): FetchOpts {
  job.assertActive();
  return { strict: true, revalidate: 0, signal: job.signal, timeoutMs: Math.max(1, Math.min(8_000, job.remainingMs() - 5_000)), deadlineMs: Math.max(1, Math.min(15_000, job.remainingMs() - 5_000)) };
}

/** The job's time budget (not its lease) ran out: committed work stays, the rest is deferred. */
export function budgetSpent(job: JobContext): boolean {
  return (job.signal.aborted && job.signal.reason instanceof JobBudgetError) || job.remainingMs() <= 0;
}
class BudgetStop extends Error {}
/** A step's failure caused by the budget running out is a stop, not a provider/persistence error. */
function rethrowIfBudget(job: JobContext): void {
  if (budgetSpent(job)) throw new BudgetStop();
}
const isComplete = (errors: string[], counts: Record<string, number>) =>
  errors.length === 0 && !Object.entries(counts).some(([key, value]) => (key.endsWith('_deferred') || key.endsWith('_pending') || key === 'budget_exhausted') && value > 0);

/**
 * Tokens precede uncached reads; replacements are atomic and audience work resumes.
 * When the time budget runs out mid-season, every transaction already committed
 * stays, and the report says so (`budget_exhausted`, deferred counts) instead of
 * throwing the progress away. A lost lease still throws.
 */
export async function synchronizeCurrentSeason(year: number, job: JobContext, operations: Operations = currentSeasonOperations, maximumRounds = 4) {
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  try {
    return await synchronizeSeasonSteps(year, job, operations, maximumRounds, counts, errors);
  } catch (error) {
    if (!(error instanceof BudgetStop) && !budgetSpent(job)) throw error;
    counts.budget_exhausted = 1;
    return { ok: errors.length === 0, counts, errors, complete: false };
  }
}

async function synchronizeSeasonSteps(year: number, job: JobContext, operations: Operations, maximumRounds: number, counts: Record<string, number>, errors: string[]) {
  job.assertActive();
  const options = () => jobReadOptions(job);
  const observation = (scope: string) => operations.begin({ source: 'jolpica', scope, jobLease: job.lease, ttlSeconds: Math.max(1, Math.min(120, Math.ceil(job.remainingMs() / 1_000))) });
  const [calendarObservation, standingsObservation] = await Promise.all([observation(`calendar:${year}`), observation(`standings:${year}`)]);
  const [scheduleRead, driverRead, teamRead] = await Promise.allSettled([
    operations.schedule(year, options()).then((rows) => rows.map(mapRace)),
    operations.drivers(year, options()), operations.teams(year, options()),
  ]);
  rethrowIfBudget(job);
  job.assertActive();
  const schedule = scheduleRead.status === 'fulfilled' ? scheduleRead.value : [];
  if (scheduleRead.status === 'rejected') errors.push(`calendar: ${errorMessage(scheduleRead.reason)}`);
  else if (!schedule.length) errors.push('calendar: incomplete empty current calendar; no replacement applied.');
  else {
    counts.schedule_rounds = schedule.length;
    if (job.remainingMs() < 10_000) counts.calendar_races_deferred = schedule.length;
    else {
      try { job.assertActive(); Object.assign(counts, await operations.calendar(year, schedule, calendarObservation)); }
      catch (error) { rethrowIfBudget(job); errors.push(`calendar: ${errorMessage(error)}`); }
    }
  }
  if (driverRead.status === 'rejected') errors.push(`drivers: ${errorMessage(driverRead.reason)}`);
  if (teamRead.status === 'rejected') errors.push(`constructors: ${errorMessage(teamRead.reason)}`);
  if (driverRead.status === 'fulfilled' && teamRead.status === 'fulfilled') {
    try {
      job.assertActive();
      if (job.remainingMs() < 7_000) counts.standings_deferred = 1;
      else {
        const drivers = driverRead.value, teams = teamRead.value;
        if ((drivers.standings.length && drivers.season !== String(year)) || (teams.standings.length && teams.season !== String(year))) throw new Error('Standings identity differs from the requested season.');
        const saved = await operations.standings(year,
          drivers.standings.map(mapDriverStanding).filter(isRankedStanding).map((entry) => ({ ...entry.driver, code: entry.driver.code ?? '', position: entry.position, points: entry.points, wins: entry.wins })),
          teams.standings.map(mapConstructorStanding).filter(isRankedStanding).map((entry) => ({ slug: entry.constructor.slug, name: entry.constructor.name, position: entry.position, points: entry.points, wins: entry.wins })),
          { driverRound: drivers.round, teamRound: teams.round }, standingsObservation);
        counts.drivers_persisted = saved.drivers; counts.teams_persisted = saved.teams;
      }
    } catch (error) { rethrowIfBudget(job); errors.push(`standings: ${errorMessage(error)}`); }
  }
  if (schedule.length && job.remainingMs() >= 15_000) {
    let eligible: Awaited<ReturnType<Operations['races']>> = [];
    try { eligible = await operations.races(year); }
    catch (error) { rethrowIfBudget(job); errors.push(`prediction candidates: ${errorMessage(error)}`); }
    const candidateRounds = [...new Set([...eligible.map((race) => race.round), ...schedule.map((race) => race.round)])];
    let classified: Set<number> | undefined;
    try { classified = new Set(await operations.classified(year)); }
    catch { counts.classification_progress_unread = 1; }
    if (classified) counts.classifications_missing_before_run = selectClassificationRounds(schedule, candidateRounds, 40).filter((round) => !classified!.has(round)).length;
    const rounds = selectClassificationRounds(schedule, candidateRounds, maximumRounds, Date.now(), classified);
    const finished = selectClassificationRounds(schedule, candidateRounds, 40);
    // Deferred = rounds that still need work: never-stored rounds left for a
    // later run. Stored rounds outside today's rotation are not outstanding.
    counts.prediction_races_deferred = classified
      ? finished.filter((round) => !classified!.has(round) && !rounds.includes(round)).length
      : Math.max(0, finished.length - rounds.length);
    for (const round of rounds) {
      if (job.remainingMs() < 15_000) { counts.prediction_races_deferred++; continue; }
      try {
        const observed = await observation(`classification:${year}:${round}`);
        const race = schedule.find((item) => item.round === round)!;
        const [result, qualifying, sprintResults] = await Promise.all([
          operations.results(year, round, options()), operations.qualifying(year, round, options()),
          race.sessions.some((session) => session.kind === 'S') ? operations.sprint(year, round, options()) : Promise.resolve(undefined),
        ]);
        job.assertActive();
        if (result && (Number(result.race.season) !== year || Number(result.race.round) !== round)) throw new Error('Classification identity differs from requested race.');
        if (!result?.results.length) { counts.classifications_pending = (counts.classifications_pending ?? 0) + 1; continue; }
        if (job.remainingMs() < 7_000) { counts.prediction_races_deferred++; continue; }
        const saved = await operations.classification({ season: year, round, results: result.results, qualifying, sprintResults, observation: observed });
        counts.classification_results = (counts.classification_results ?? 0) + saved.results;
        let cursor: string | undefined;
        let complete = false;
        let pending = 0;
        do {
          if (job.remainingMs() < 7_000) { counts.prediction_pages_deferred = (counts.prediction_pages_deferred ?? 0) + 1; break; }
          job.assertActive();
          const grades = await operations.grade(year, round, result.results, qualifying, { observation: observed, afterId: cursor, batchSize: 500 });
          for (const key of ['graded', 'conflicted'] as const) counts[`predictions_${key}`] = (counts[`predictions_${key}`] ?? 0) + grades[key];
          pending = grades.pending;
          cursor = grades.nextCursor ?? undefined; complete = grades.complete;
          if (!complete && !cursor) counts.prediction_pages_deferred = (counts.prediction_pages_deferred ?? 0) + 1;
        } while (!complete && cursor);
        counts.predictions_pending = (counts.predictions_pending ?? 0) + pending;
      } catch (error) {
        if (budgetSpent(job)) { counts.prediction_races_deferred++; throw new BudgetStop(); }
        errors.push(`round ${round}: ${errorMessage(error)}`);
      }
    }
  } else if (schedule.length) counts.prediction_races_deferred = schedule.length;
  job.assertActive();
  return { ok: errors.length === 0, counts, errors, complete: isComplete(errors, counts) };
}
