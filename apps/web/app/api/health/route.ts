import { pingDatabase, recentIngestionSummary } from '@apex/db';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { rateLimitShared } from '@/lib/distributed-rate-limit';
import { rateLimit } from '@/lib/rate-limit';
import { cachedProviderProbe, pingRedis, runHealthChecks } from '@/lib/health';
import { errorSummary, logEvent } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const NO_STORE = { 'cache-control': 'no-store, max-age=0', 'x-robots-tag': 'noindex' };

/**
 * GET /api/health: database, Redis and provider reachability for uptime
 * monitors. Public answers carry only status words and latencies. A caller
 * holding the cron bearer token also gets the latest ingestion_run per source
 * and the ten most recent failures, which is where cron/ingestion failures
 * are seen without opening the database.
 */
export async function GET(request: Request) {
  // Shared quota first; if Redis itself is the outage, fall back to the
  // per-instance brake so the endpoint can still report that outage.
  const shared = await rateLimitShared(request, { limit: 30, windowMs: 60_000, bucket: 'health' });
  const limited = shared.available ? shared : rateLimit(request, { limit: 30, windowMs: 60_000, bucket: 'health' });
  if (!limited.ok) {
    return Response.json({ ok: false, error: 'Too many health checks; slow down.' }, { status: 429, headers: { ...NO_STORE, 'retry-after': String(limited.retryAfter) } });
  }

  const { httpStatus, body } = await runHealthChecks({
    env: process.env,
    database: pingDatabase,
    redis: () => pingRedis(process.env, AbortSignal.timeout(2_500)),
    provider: (name) => cachedProviderProbe(name, process.env),
  });
  if (body.status !== 'ok') logEvent(body.status === 'down' ? 'error' : 'warn', 'health.check', { status: body.status, checks: body.checks });

  let ingestion: Awaited<ReturnType<typeof recentIngestionSummary>> | { unavailable: true } | undefined;
  if (isAuthorizedCronRequest(request)) {
    try { ingestion = await recentIngestionSummary(); }
    catch (error) { logEvent('warn', 'health.ingestion-unavailable', { cause: errorSummary(error) }); ingestion = { unavailable: true }; }
  }
  return Response.json(ingestion ? { ...body, ingestion } : body, { status: httpStatus, headers: NO_STORE });
}
