/**
 * RSS + multi-source news sync cron.
 *
 * Refreshes the supported Next.js news cache tag and warms the aggregated feed.
 * Provider fanout and quota depend on enabled sources; no billing claim is made.
 *
 * Schedule is managed by the repository deployment workflow.
 * Auth: Bearer CRON_SECRET only.
 * This job reports source counts and cache refreshes; it does not persist articles.
 * A source failing is listed in sourceHealth; the run is degraded only when coverage is
 * lost (lib/news-coverage.ts: under half the sources answered). Every source
 * failing only because it is unavailable answers the provider-unavailable
 * contract (503, lib/cron-outcome.ts); any other total failure stays HTTP 500.
 */

import { NextResponse } from "next/server";
import { newsCoverageDegraded } from "@/lib/news-coverage";
import {
  getF1NewsFeed,
  RSS_NEWS_CACHE_TAG,
  type NewsSourceReport,
} from "@apex/api-client/rss";
import { readThenRefresh } from "@/lib/cache-refresh";
import {
  buildReport,
  isAuthorizedCronRequest,
  logReport,
  timed,
} from "@/lib/cron-auth";
import { safeErrorMessage } from "@/lib/api-input";
import { runLeasedCron } from '@/lib/leased-cron';
import { providerUnavailableResponse } from "@/lib/cron-outcome";
import type { JobContext } from '../../../../../workers/src/lib/job-control';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // Idempotent cache refresh: runs unleased when no database is configured.
  return runLeasedCron(req, 'rss-sync', (job) => synchronize(req, job), { lease: 'optional' });
}
async function synchronize(req: Request, job: JobContext) {
  const start = Date.now();

  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  const counts: Record<string, number> = {};
  let total = 0;
  let error: string | undefined;
  let fetchMs = 0;
  const sourceHealth: NewsSourceReport[] = [];

  try {
    // Read first; the RSS tag is refreshed (stale-while-revalidate) only after a
    // successful read, so a failing source keeps its last good copy (R3-BE-4).
    // Paid-provider caches retain their account floors; this job refreshes RSS only.
    const [items, ms] = await timed(() => readThenRefresh(RSS_NEWS_CACHE_TAG, () =>
      getF1NewsFeed({
        limit: 120,
        revalidate: 300,
        strict: true,
        signal: job.signal,
        timeoutMs: Math.max(1, Math.min(15_000, job.remainingMs() - 5_000)),
        onSourceResult: (report) => {
          sourceHealth.push(report);
        },
      })),
    );
    fetchMs = ms;
    total = items.length;

    for (const it of items) {
      const key = it.source ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    // Tagged dependencies invalidate their pages too. Broad path expiration here
    // would also evict paid-provider fetches and defeat their cache floors.
  } catch (err) {
    error = safeErrorMessage(err);
  }

  const failed = sourceHealth.filter((source) => !source.ok);
  if (error && failed.length > 0 && failed.length === sourceHealth.length && failed.every((source) => source.unavailable === true))
    return providerUnavailableResponse(start, {
      route: "rss-sync",
      provider: "news-sources",
      error: `Every news source is unavailable (${failed.length}); the last good articles stay cached. The next run retries.`,
      results: { total, sources: counts, sourceHealth, fetchMs },
    });
  const report = buildReport(start, {
    ok: !error,
    route: "rss-sync",
    results: { total, sources: counts, sourceHealth, fetchMs },
    ...(error ? { error } : {}),
  });
  const responseReport = {
    ...report,
    degraded: newsCoverageDegraded(sourceHealth),
  };
  logReport(responseReport);
  return NextResponse.json(responseReport, { status: error ? 500 : 200 });
}
