import { revalidateTag } from 'next/cache';
import { VIDEO_CACHE_TAG } from '@apex/api-client/youtube';
import { beginSourceObservation, getYoutubeVideoIdsForVerification, persistVideoDetailsSnapshot, type SourceObservation } from '@apex/db';
import { syncRecentYouTubeUploads, youtubeSyncReaders } from '@/lib/youtube-sync';
import { handleYouTubeSync } from '@/lib/youtube-cron';
import { buildReport, isAuthorizedCronRequest, logReport } from '@/lib/cron-auth';
import { runLeasedCron } from '@/lib/leased-cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const configurationOnly = {
    refresh: () => {}, sync: async () => { throw new Error('No provider reads before complete job configuration.'); },
  };
  if (!isAuthorizedCronRequest(request) || !process.env.YOUTUBE_API_KEY) return handleYouTubeSync(request, configurationOnly);
  if (!process.env.DATABASE_URL) {
    // Pages read YouTube through the tagged fetch cache, so refreshing the tag
    // is the useful part of this job; without a database there is no snapshot
    // to persist, which is a healthy cache-only run, not a failure.
    const start = Date.now();
    try { revalidateTag(VIDEO_CACHE_TAG, { expire: 0 }); }
    catch {
      const report = buildReport(start, { ok: false, route: 'youtube-sync', error: 'Video cache refresh failed.' });
      logReport(report);
      return Response.json(report, { status: 500 });
    }
    const report = buildReport(start, { ok: true, route: 'youtube-sync', skipped: 'DATABASE_URL unset: video cache refreshed; no snapshot persisted.' });
    logReport(report);
    return Response.json(report, { headers: { 'cache-control': 'no-store' } });
  }
  return runLeasedCron(request, 'youtube-sync', async (job) => {
    let observation: SourceObservation | undefined;
    return handleYouTubeSync(request, {
      refresh: () => revalidateTag(VIDEO_CACHE_TAG, { expire: 0 }),
      sync: () => syncRecentYouTubeUploads({
        ...youtubeSyncReaders, signal: job.signal,
        begin: async () => { observation = await beginSourceObservation({ source: 'youtube', scope: 'details', ttlSeconds: 120, jobLease: job.lease }); },
        verifyStored: (excludeVideoIds) => getYoutubeVideoIdsForVerification({ excludeVideoIds, limit: 100 }),
        reconcile: async (snapshot) => {
          job.assertActive();
          if (!observation) throw new Error('No video source observation was reserved.');
          return persistVideoDetailsSnapshot({ ...snapshot, observation });
        },
        persist: async () => { throw new Error('Unfenced video writes are disabled for scheduled ingestion.'); },
      }),
    });
  });
}
