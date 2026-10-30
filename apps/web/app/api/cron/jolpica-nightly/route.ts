import { runLeasedCron } from '@/lib/leased-cron';
import { seasonCronTask } from '@/lib/season-cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Daily season sync (hosting cron) and its catch-up runs; the work is in lib/season-cron.ts. */
export async function GET(request: Request) {
  return runLeasedCron(request, 'jolpica-nightly', (job) => seasonCronTask(job), { partialOnBudget: true });
}
