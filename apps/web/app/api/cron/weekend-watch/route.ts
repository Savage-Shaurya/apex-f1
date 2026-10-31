/**
 * Race-weekend watch cron (lib/weekend-watch.ts).
 *
 * Schedule: every 10 minutes Friday to Monday (UTC) via
 * .github/workflows/refresh-weekend.yml. Outside a due classification window
 * it makes one cached calendar read and returns `skipped`. While Jolpica is
 * unavailable the last validated calendar (up to 7 days old) is used and the
 * report is `degraded`; a due classification that cannot be read because
 * Jolpica is unavailable is deferred with the provider-unavailable contract
 * (503, lib/cron-outcome.ts). Any other failure stays HTTP 500.
 * Auth: Bearer CRON_SECRET only. Never sends email.
 */
import { nextCache } from '@/lib/next-cache';
import { invalidateLocalJolpicaSeason, jolpica } from '@apex/api-client/jolpica';
import { lastGoodRedisConfig } from '@apex/api-client/openf1';
import { synchronizeActiveSeasons } from '../../../../../workers/src/lib/season-sync-plan';
import { jobReadOptions } from '../../../../../workers/src/lib/current-season-sync';
import { PARTIAL_ON_BUDGET_HEADER, runLeasedCron } from '@/lib/leased-cron';
import { buildReport, logReport } from '@/lib/cron-auth';
import { calendarReport, providerUnavailableResponse, readCronCalendar, unavailableProvider, type CronCalendar } from '@/lib/cron-outcome';
import { weekendWatchTargets } from '@/lib/data-freshness';
import { layeredFingerprintStore, pathsFor, redisFingerprintStore, runWeekendWatch, type WatchRace } from '@/lib/weekend-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  // Cache refresh works without a database; with one, the lease fences race ingestion.
  return runLeasedCron(request, 'weekend-watch', async (job) => {
    const start = Date.now();
    const now = Date.now();
    let calendar: CronCalendar;
    try {
      calendar = await readCronCalendar({ revalidate: 900, signal: job.signal, timeoutMs: 8_000 });
    } catch (error) {
      const provider = unavailableProvider([error]);
      if (provider) return providerUnavailableResponse(start, { route: 'weekend-watch', provider, error: 'calendar: Jolpica F1 is unavailable and no validated calendar copy exists; the next run retries.' });
      const report = buildReport(start, { ok: false, route: 'weekend-watch', error: 'calendar: Jolpica F1 could not be read or was invalid; the next run retries.' });
      logReport(report);
      return Response.json(report, { status: 500, headers: { 'cache-control': 'no-store' } });
    }
    const races: WatchRace[] = calendar.races;
    const { degraded: staleCalendar, calendar: calendarSource } = calendarReport(calendar);
    if (!weekendWatchTargets(races, now).length) {
      const report = { ...buildReport(start, { ok: true, route: 'weekend-watch', skipped: 'No qualifying, sprint or race classification is due; nothing to check.', results: { calendar: calendarSource } }), ...(staleCalendar ? { degraded: true } : {}) };
      logReport(report);
      return Response.json(report, { headers: { 'cache-control': 'no-store' } });
    }
    const redis = lastGoodRedisConfig();
    const invalidated = new Set<number>();
    // An unleased run (database unset or unreachable) refreshes caches only; it never ingests.
    const databaseLease = Boolean(process.env.DATABASE_URL) && !job.unleased;
    const result = await runWeekendWatch({
      now,
      races,
      // Process memory behind Redis (review R-07): Redis down never means a purge every run.
      store: layeredFingerprintStore(redis ? redisFingerprintStore(redis) : null),
      hasTime: () => job.remainingMs() > 12_000,
      read: async (target) => {
        // Uncached and strict: a failure is an error, never "not published".
        const options = jobReadOptions(job);
        if (target.kind === 'Q') return jolpica.getQualifyingFull(target.season, target.round, options);
        if (target.kind === 'S') return jolpica.getSprint(target.season, target.round, options);
        return (await jolpica.getRaceResults(target.season, target.round, options))?.results ?? [];
      },
      revalidate: async (target, race) => {
        if (!invalidated.has(target.season)) {
          invalidated.add(target.season);
          // This instance's validated copies of the season go; others expire within their 60 s weekend lifetime.
          await invalidateLocalJolpicaSeason(target.season, { current: true, finished: false }).catch(() => undefined);
          nextCache.revalidateTag(`jolpica:season:${target.season}`, { expire: 0 });
        }
        for (const path of pathsFor(target, race)) nextCache.revalidatePath(path);
      },
      ...(databaseLease ? {
        ingest: async () => {
          const synced = await synchronizeActiveSeasons(job, { maximumRounds: 2 });
          return synced.ok && (synced.counts.classification_results ?? 0) > 0;
        },
      } : {}),
    });
    const ok = result.errors.length === 0;
    // Every failure was Jolpica being unavailable: the due classifications are deferred, not failed.
    if (!ok && result.unavailable === result.errors.length)
      return providerUnavailableResponse(start, {
        route: 'weekend-watch', provider: 'jolpica',
        error: 'Due classifications could not be read while Jolpica F1 is unavailable; the next run retries.',
        results: { ...result, calendar: calendarSource },
      });
    const report = {
      ...buildReport(start, { ok, route: 'weekend-watch', results: { ...result, calendar: calendarSource } }),
      ...(staleCalendar ? { degraded: true } : {}),
      continuation: ok && result.deferred > 0,
    };
    logReport(report);
    const headers: Record<string, string> = { 'cache-control': 'no-store' };
    if (result.deferred > 0) headers[PARTIAL_ON_BUDGET_HEADER] = 'budget';
    return Response.json(report, { status: ok ? 200 : 500, headers });
  }, { lease: 'optional', partialOnBudget: true });
}
