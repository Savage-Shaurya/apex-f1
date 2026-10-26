import { logEvent } from "./log";
/**
 * Cron authorization + observability primitives.
 *
 * Every /api/cron/* route in Apex shares the same auth gate and the same
 * structured-report envelope so a single log filter in Vercel surfaces
 * every cron tick. Keep helpers here · do not duplicate per route.
 *
 * Auth model — bearer token ONLY.
 *   - Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on its
 *     own scheduled invocations whenever CRON_SECRET is set as a project env
 *     var. This is Vercel's documented mechanism for securing cron endpoints.
 *   - Off-platform callers (GitHub Actions, manual terminal replays) send the
 *     same header explicitly.
 *   - With CRON_SECRET unset every request is rejected. Fail closed.
 *
 * SECURITY HISTORY — do not reintroduce:
 *   This gate previously short-circuited to `true` on the presence of an
 *   `x-vercel-cron` header, on the assumption that Vercel's edge strips it
 *   from inbound public traffic. That assumption is false and was verified
 *   exploitable in production on 2026-07-28: a plain
 *   `curl -H 'x-vercel-cron: 1' <host>/api/cron/weather-sync` returned HTTP
 *   200 and executed the job. Every /api/cron/* route was publicly
 *   triggerable, including newsletter-blast, which sends a Resend broadcast
 *   to the entire audience. `x-vercel-cron` is NOT an authentication signal
 *   and must never be trusted. Vercel documents only `x-vercel-cron-schedule`
 *   and treats it as informational, not as auth.
 */

/**
 * Length-independent, content-constant-time string compare.
 *
 * Pure JS so this stays valid on both the Node and Edge runtimes (node:crypto
 * timingSafeEqual is unavailable on Edge). Length is allowed to leak — that
 * only reveals the secret's length, not its bytes.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env["CRON_SECRET"];
  // Fail closed. No secret configured means no caller can be authorized.
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return safeEqual(auth, `Bearer ${secret}`);
}

/** Standard JSON envelope for cron reports. Every route returns this shape. */
export interface CronReport {
  ok: boolean;
  /** Short route identifier (e.g. "rss-sync") for log grep. Optional for
   * backwards-compat · prefer passing it for every new cron. */
  route?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results?: Record<string, unknown>;
  skipped?: string;
  error?: string;
}

export function buildReport(
  startMs: number,
  partial: Omit<CronReport, "startedAt" | "finishedAt" | "durationMs">,
): CronReport {
  const finishMs = Date.now();
  return {
    startedAt: new Date(startMs).toISOString(),
    finishedAt: new Date(finishMs).toISOString(),
    durationMs: finishMs - startMs,
    ...partial,
  };
}

/**
 * Emit the report as a single-line JSON log so Vercel's log-aggregator can
 * parse it and the operator can grep `route=` to filter by job. Call this
 * exactly once per route, right before NextResponse.json(...).
 */
export function logReport(report: CronReport): void {
  // Failures log at error level so Vercel's "Errors" filter and log drains
  // surface them; the durable record is the ingestion_run row (see /api/health).
  logEvent(report.ok ? "info" : "error", "cron.report", { ...report });
}

/**
 * Retry a promise-returning function with exponential backoff. Useful for
 * upstream APIs that hiccup intermittently · Jolpica's free tier 429s under
 * burst, Open-Meteo can 503 during cold edges, etc.
 *
 * Defaults: 3 attempts, 250ms base, 2x growth (250 / 500 / 1000ms total wait).
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    growth?: number;
    deadlineMs?: number;
  } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(3, Math.floor(opts.attempts ?? 3)));
  const baseDelayMs = Math.max(0, Math.min(1_000, opts.baseDelayMs ?? 250));
  const growth = Math.max(1, Math.min(3, opts.growth ?? 2));
  const expires = Date.now() + (opts.deadlineMs ?? 45_000);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status =
        typeof err === "object" && err !== null && "status" in err
          ? Number(err.status)
          : undefined;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(growth, i);
        if (Date.now() + delay >= expires) throw err;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Timed-section helper. Wraps an async fn so the cron route can report
 * per-upstream timings in its `results` block · helps the operator know
 * which provider is slowing a 50s budget.
 *
 * Example:
 *   const [items, ms] = await timed(() => getF1NewsFeed(...));
 *   results.rssMs = ms;
 */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const result = await fn();
  return [result, Date.now() - t];
}
