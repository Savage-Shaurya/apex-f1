import { nextCache } from './next-cache';
import { invalidateLocalJolpicaSeason } from '@apex/api-client/jolpica';
import { synchronizeActiveSeasons } from '../../workers/src/lib/season-sync-plan';
import { currentSeasonOperations } from '../../workers/src/lib/current-season-sync';
import type { JobContext } from '../../workers/src/lib/job-control';
import { PARTIAL_ON_BUDGET_HEADER } from './leased-cron';
import { buildReport, logReport } from './cron-auth';
import { providerUnavailableResponse } from './cron-outcome';

/** Next cache hooks and persistence, injectable so the outage matrix runs without Next or a database. */
export interface SeasonCronDependencies {
  operations: typeof currentSeasonOperations;
  invalidateSeason: typeof invalidateLocalJolpicaSeason;
  revalidateTag(tag: string): void;
  revalidatePath(path: string): void;
}
const defaults: SeasonCronDependencies = {
  operations: currentSeasonOperations,
  invalidateSeason: invalidateLocalJolpicaSeason,
  revalidateTag: (tag) => nextCache.revalidateTag(tag, { expire: 0 }),
  revalidatePath: (path) => nextCache.revalidatePath(path),
};

/**
 * The season sync behind /api/cron/jolpica-nightly. Seasons come from the real
 * calendar: the active season, plus the previous one until 30 days after its
 * final race. Never the clock year. The 45 s budget (Vercel's 60 s limit)
 * bounds the work, not a fixed round count: each round is attempted only while
 * 15 s remain, missing rounds are filled first, and anything left is reported
 * as deferred for the catch-up runs (.github/workflows/refresh-season.yml).
 * A sync that failed only because Jolpica was unavailable answers the
 * provider-unavailable contract (503, lib/cron-outcome.ts).
 */
export async function seasonCronTask(job: JobContext, deps: SeasonCronDependencies = defaults): Promise<Response> {
  const start = Date.now();
  const result = await synchronizeActiveSeasons(job, {
    maximumRounds: 24,
    operations: deps.operations,
    beforeSeason: async (year, plan) => {
      await deps.invalidateSeason(year, { current: year === plan.currentAlias, finished: plan.finished.includes(year) });
      deps.revalidateTag(`jolpica:season:${year}`);
    },
    afterSeason: (year, plan) => {
      for (const path of ['/', '/schedule', `/schedule/${year}`, `/results/${year}/drivers`, `/results/${year}/teams`, '/drivers', '/teams', '/predict']) deps.revalidatePath(path);
      if (plan.finished.includes(year)) for (const path of ['/drivers/champions', '/teams/champions']) deps.revalidatePath(path);
    },
  });
  const results = { seasons: result.seasons, counts: result.counts, bySeason: result.bySeason, errors: result.errors, warnings: result.warnings };
  // Failed only because Jolpica was unavailable: committed work stays, the rest is retried.
  if (!result.ok && result.providerUnavailable)
    return providerUnavailableResponse(start, { route: 'jolpica-nightly', provider: 'jolpica', error: 'Season data could not be read while Jolpica F1 is unavailable; previous verified data was kept and the next run retries.', results });
  const report = {
    ...buildReport(start, { ok: result.ok, route: 'jolpica-nightly', results }),
    complete: result.complete,
    // Deferred work is resumable, not a failure: the next run continues it.
    continuation: result.ok && !result.complete,
  };
  logReport(report);
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (result.counts.budget_exhausted) headers[PARTIAL_ON_BUDGET_HEADER] = 'budget';
  return Response.json(report, { status: result.ok ? 200 : 500, headers });
}
