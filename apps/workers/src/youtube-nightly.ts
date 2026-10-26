import { closeDb, beginSourceObservation, getYoutubeVideoIdsForVerification, persistVideoDetailsSnapshot, type SourceObservation } from '@apex/db';
import { syncRecentYouTubeUploads, youtubeSyncReaders } from './lib/youtube-sync';
import { runWorker } from './lib/runner';

async function main() {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YouTube API configuration is required.');
  // CLI and deployed cron intentionally use the same shared owner key.
  await runWorker('youtube-sync', async (job) => {
    let observation: SourceObservation | undefined;
    const result = await syncRecentYouTubeUploads({
      ...youtubeSyncReaders, signal: job.signal,
      begin: async () => { observation = await beginSourceObservation({ source: 'youtube', scope: 'details', ttlSeconds: 120, jobLease: job.lease }); },
      verifyStored: (excludeVideoIds) => getYoutubeVideoIdsForVerification({ excludeVideoIds, limit: 100 }),
      reconcile: async (snapshot) => {
        job.assertActive();
        if (!observation) throw new Error('No video source observation was reserved.');
        return persistVideoDetailsSnapshot({ ...snapshot, observation });
      },
      persist: async () => { throw new Error('Unfenced video writes are disabled for scheduled ingestion.'); },
    });
    job.log(JSON.stringify(result.totals));
    job.bump({ itemsIn: result.totals.videosFetched, itemsOut: result.totals.videosPersisted });
    if (!result.ok) throw new Error('YouTube synchronization failed; inspect the channel and persistence reports.');
  });
}
main().finally(closeDb).catch(() => { console.error('YouTube ingestion failed; no unverified video removals were applied.'); process.exitCode = 1; });
