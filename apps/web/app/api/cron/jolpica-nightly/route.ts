import { revalidatePath, revalidateTag } from 'next/cache';
import { invalidateLocalJolpicaSeason } from '@apex/api-client/jolpica';
import { synchronizeActiveSeasons } from '../../../../../workers/src/lib/season-sync-plan';
import { PARTIAL_ON_BUDGET_HEADER, runLeasedCron } from '@/lib/leased-cron';
import { buildReport, logReport } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return runLeasedCron(request, 'jolpica-nightly', async (job) => {
    const start = Date.now();
    // Seasons come from the real calendar: the active season, plus the previous
    // one until 30 days after its final race. Never the clock year.
    // The 45 s budget (Vercel's 60 s limit) bounds the work, not a fixed round
    // count: each round is attempted only while 15 s remain, missing rounds are
    // filled first, and anything left is reported as deferred for the
    // catch-up runs (.github/workflows/refresh-season.yml) to continue.
    const result = await synchronizeActiveSeasons(job, {
      maximumRounds: 24,
      beforeSeason: async (year, plan) => {
        await invalidateLocalJolpicaSeason(year, { current: year === plan.currentAlias, finished: plan.finished.includes(year) });
        revalidateTag(`jolpica:season:${year}`, { expire: 0 });
      },
      afterSeason: (year, plan) => {
        for (const path of ['/', '/schedule', `/schedule/${year}`, `/results/${year}/drivers`, `/results/${year}/teams`, '/drivers', '/teams', '/predict']) revalidatePath(path);
        if (plan.finished.includes(year)) for (const path of ['/drivers/champions', '/teams/champions']) revalidatePath(path);
      },
    });
    const report = {
      ...buildReport(start, { ok: result.ok, route: 'jolpica-nightly', results: { seasons: result.seasons, counts: result.counts, bySeason: result.bySeason, errors: result.errors, warnings: result.warnings } }),
      complete: result.complete,
      // Deferred work is resumable, not a failure: the next run continues it.
      continuation: result.ok && !result.complete,
    };
    logReport(report);
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    if (result.counts.budget_exhausted) headers[PARTIAL_ON_BUDGET_HEADER] = 'budget';
    return Response.json(report, { status: result.ok ? 200 : 500, headers });
  }, { partialOnBudget: true });
}
