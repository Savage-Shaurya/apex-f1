/** Daily calendar/classification/standings and resumable prediction grading for the active season(s). */
import { closeDb } from '@apex/db';
import { runWorker } from './lib/runner';
import { synchronizeActiveSeasons } from './lib/season-sync-plan';

async function main() {
  await runWorker('jolpica-nightly', async (job) => {
    // Seasons come from the real calendar (active + previous within 30 days of its finale), never the clock year.
    const result = await synchronizeActiveSeasons(job, { maximumRounds: 40 });
    job.log(JSON.stringify({ seasons: result.seasons, counts: result.bySeason, complete: result.complete }));
    for (const warning of result.warnings) job.log(`warning: ${warning}`);
    job.bump({ itemsIn: result.counts.schedule_rounds ?? 0, itemsOut: (result.counts.classification_results ?? 0) + (result.counts.predictions_graded ?? 0) });
    if (!result.ok) throw new Error(result.errors.join('; '));
  });
}
main().finally(closeDb).catch(() => { console.error('Current-season ingestion failed; previous verified data was retained.'); process.exitCode = 1; });
