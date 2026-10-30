import { appendFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// newsletter-blast is deliberately absent: it sends real email and only the hosting cron may call it.
const ROUTES = new Set(["rss-sync", "weather-sync", "jolpica-nightly", "weekend-watch", "youtube-sync"]);
/** Upper bound for `--until-complete=N` (each run is one bounded cron request). */
const MAX_CONTINUATIONS = 12;
const REQUEST_TIMEOUT_MS = 65_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

class CronInvocationError extends Error {}
/** Gateway errors and dropped connections: retried, but never green on their own. */
class TransientCronError extends CronInvocationError {}
/**
 * The route's documented outage report (apps/web/lib/cron-outcome.ts): HTTP 503
 * { ok:false, retryable:true, reason:"provider-unavailable", provider, lastSuccessAt }.
 */
class ProviderUnavailableError extends CronInvocationError {
  constructor(route, provider, lastSuccessAt) {
    super(`Cron returned HTTP 503: ${route}: provider unavailable (${provider}).`);
    this.route = route;
    this.provider = provider;
    /** Epoch ms of the route's last successful run, or null when unknown. */
    this.lastSuccessAt = lastSuccessAt;
  }
}

const HOUR_MS = 3_600_000;
/**
 * How long a route may go without a successful run before an outage is no
 * longer "temporary" and the workflow fails red (DEPLOY.md, cron resilience).
 */
export const STALE_AFTER_HOURS = {
  "weather-sync": 48,
  "weekend-watch": 48,
  "jolpica-nightly": 72,
  "rss-sync": 48,
  "youtube-sync": 48,
};
/** Waits before the 2nd and 3rd attempt: three tries in all, inside the run budget. */
export const RETRY_DELAYS_MS = [30_000, 90_000];
/**
 * Retries and continuations stop when the next wait plus a full request would
 * pass this, so a run lasts at most RUN_BUDGET_MS + one request (about 8 min),
 * inside every refresh workflow's timeout (scripts/cron-coverage.test.mjs checks).
 */
export const RUN_BUDGET_MS = 7 * 60_000;
export { REQUEST_TIMEOUT_MS };
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** A clock-skew allowance; a lastSuccessAt further in the future is invalid. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function endpointFor(siteUrl, route, secret) {
  if (!ROUTES.has(route))
    throw new CronInvocationError("Choose rss-sync, weather-sync, jolpica-nightly, weekend-watch or youtube-sync.");
  if (typeof secret !== "string" || !secret.trim() || /[\r\n]/.test(secret)) {
    throw new CronInvocationError("CRON_SECRET is missing or invalid.");
  }
  let origin;
  try {
    origin = new URL(typeof siteUrl === "string" ? siteUrl.trim() : "");
  } catch {
    throw new CronInvocationError("APEX_SITE_URL must be an HTTPS origin.");
  }
  // Plain http only for a local server on this machine (outage simulations, local checks).
  const loopback = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    (origin.protocol !== "https:" && !loopback) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new CronInvocationError(
      "APEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  return new URL(`/api/cron/${route}`, origin);
}

async function readReport(response, signal, maxBytes) {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new CronInvocationError("Cron response exceeds the size limit.");
  }
  if (!response.body)
    throw new CronInvocationError("Cron response has no JSON report.");
  const reader = response.body.getReader();
  const abortRead = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abortRead, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted)
        throw new CronInvocationError("Cron request exceeded its deadline.");
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new CronInvocationError("Cron response exceeds the size limit.");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    } catch {
      throw new CronInvocationError(
        "Cron response is not a valid JSON report.",
      );
    }
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
}

/** The outage report, validated field by field; anything else is an ordinary failure. */
function outageFrom(report, route, now) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.ok !== false ||
    report.route !== route ||
    report.retryable !== true ||
    report.reason !== "provider-unavailable"
  )
    return null;
  const provider =
    typeof report.provider === "string" && /^[a-z0-9-]{1,32}$/.test(report.provider)
      ? report.provider
      : "unknown provider";
  let lastSuccessAt = null;
  if (typeof report.lastSuccessAt === "string" && ISO_INSTANT.test(report.lastSuccessAt)) {
    const at = Date.parse(report.lastSuccessAt);
    if (Number.isFinite(at) && at <= now + FUTURE_TOLERANCE_MS) lastSuccessAt = at;
  }
  return new ProviderUnavailableError(route, provider, lastSuccessAt);
}

/**
 * One bounded invocation (the caller decides about retries). A 503 carrying
 * the provider-unavailable report throws ProviderUnavailableError; 502/504
 * and transport failures throw TransientCronError; anything else is final.
 */
export async function invokeCron({
  siteUrl,
  secret,
  route,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  now = Date.now,
}) {
  const endpoint = endpointFor(siteUrl, route, secret);
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > REQUEST_TIMEOUT_MS ||
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw new CronInvocationError("Cron transport limits are invalid.");
  }
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CronInvocationError("Cron request exceeded its deadline."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const response = await fetchImpl(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${secret}`,
            Accept: "application/json",
          },
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 503 && /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
          let report = null;
          try {
            report = await readReport(response, controller.signal, maxResponseBytes);
          } catch {
            report = null;
          }
          const outage = outageFrom(report, route, now());
          if (outage) throw outage;
          throw new CronInvocationError("Cron returned HTTP 503.");
        }
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          const Failure = response.status === 502 || response.status === 504 ? TransientCronError : CronInvocationError;
          throw new Failure(`Cron returned HTTP ${response.status}.`);
        }
        if (
          !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        ) {
          void response.body?.cancel().catch(() => {});
          throw new CronInvocationError(
            "Cron response must have a JSON content type.",
          );
        }
        const report = await readReport(
          response,
          controller.signal,
          maxResponseBytes,
        );
        if (
          !report ||
          typeof report !== "object" ||
          Array.isArray(report) ||
          report.ok !== true ||
          report.route !== route
        ) {
          throw new CronInvocationError(
            "Cron report must confirm ok:true and the expected route.",
          );
        }
        return {
          route,
          degraded:
            report.degraded === true || report.results?.degraded === true,
          // jolpica-nightly: deferred rounds remain for the next run (not a failure).
          continuation: report.continuation === true,
          durationMs:
            typeof report.durationMs === "number" &&
            Number.isFinite(report.durationMs) &&
            report.durationMs >= 0 &&
            report.durationMs <= 86_400_000
              ? report.durationMs
              : null,
        };
      })(),
    ]);
  } catch (error) {
    if (error instanceof ProviderUnavailableError) throw error;
    if (controller.signal.aborted)
      throw new TransientCronError("Cron request exceeded its deadline.");
    if (error instanceof CronInvocationError) throw error;
    // Fetch exceptions can include a URL, token or upstream payload. Never print them.
    throw new TransientCronError(
      "Cron transport failed before a valid report was received.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Optional local override, e.g. "5,10" for an outage simulation; bounded to 1-300 s each, at most two waits. */
function retryDelaysFrom(env) {
  const raw = env.APEX_CRON_RETRY_DELAYS_SECONDS;
  if (raw === undefined || raw === "") return RETRY_DELAYS_MS;
  if (!/^\d{1,3}(?:,\d{1,3})?$/.test(raw)) throw new CronInvocationError("APEX_CRON_RETRY_DELAYS_SECONDS must be one or two whole seconds, e.g. 30,90.");
  const delays = raw.split(",").map(Number);
  if (delays.some((value) => value < 1 || value > 300)) throw new CronInvocationError("APEX_CRON_RETRY_DELAYS_SECONDS must be between 1 and 300 seconds.");
  return delays.map((value) => value * 1000);
}

function defaultAppendSummary(env) {
  return (text) => {
    if (!env.GITHUB_STEP_SUMMARY) return;
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    } catch {
      // The job summary is a convenience; the annotation already carries the message.
    }
  };
}

export async function runCronCommand(
  args,
  env,
  {
    fetchImpl = fetch,
    log = console.log,
    errorLog = console.error,
    appendSummary = defaultAppendSummary(env),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    budgetMs = RUN_BUDGET_MS,
    timeoutMs,
    maxResponseBytes,
  } = {},
) {
  const route = args[0];
  try {
    // `<route>` or `<route> --until-complete=N`: a report with continuation:true
    // (work deferred at the time budget, e.g. a fresh season fill) is followed by
    // another request, at most N in all.
    if (args.length < 1 || args.length > 2)
      throw new CronInvocationError("Pass exactly one cron route.");
    let runs = 1;
    if (args.length === 2) {
      const match = /^--until-complete=(\d{1,2})$/.exec(args[1]);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > MAX_CONTINUATIONS)
        throw new CronInvocationError("Pass exactly one cron route.");
      runs = Number(match[1]);
    }
    const delays = retryDelaysFrom(env);
    const started = now();
    for (let run = 1; run <= runs; run++) {
      // Transient failures (the provider-unavailable report, 502/504, a dropped
      // connection or a stalled request) are retried with backoff while the run
      // budget allows: the jobs are leased and idempotent. Everything else is final.
      let result;
      for (let attempt = 0; ; attempt++) {
        try {
          result = await invokeCron({
            siteUrl: env.APEX_SITE_URL,
            secret: env.CRON_SECRET,
            route,
            fetchImpl,
            timeoutMs,
            maxResponseBytes,
            now,
          });
          break;
        } catch (error) {
          const delay = delays[attempt];
          const retryable = error instanceof ProviderUnavailableError || error instanceof TransientCronError;
          if (!retryable || delay === undefined || now() - started + delay + (timeoutMs ?? REQUEST_TIMEOUT_MS) > budgetMs)
            throw error;
          log(`[cron] ${route}: ${error.message} Retrying in ${Math.round(delay / 1000)} s (attempt ${attempt + 2} of ${delays.length + 1}).`);
          await sleep(delay);
        }
      }
      log(
        `[cron] ${result.route} -> HTTP 200; report ok${result.durationMs === null ? "" : `; duration ${result.durationMs}ms`}${runs > 1 ? `; run ${run} of at most ${runs}` : ""}`,
      );
      if (result.degraded) {
        log(
          `::warning::${result.route} completed with degraded provider availability.`,
        );
        appendSummary(`- ⚠️ \`${result.route}\` completed with degraded provider availability (for example, it used the last validated calendar).`);
      }
      if (!result.continuation) break;
      if (run < runs && now() - started + (timeoutMs ?? REQUEST_TIMEOUT_MS) > budgetMs) {
        log(`::notice::${result.route} deferred some work; the run budget is spent and the next scheduled run continues it.`);
        break;
      }
      if (run === runs)
        log(
          `::notice::${result.route} deferred some work within its time budget; the next scheduled run continues it.`,
        );
    }
    return 0;
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      // Still unavailable after the retries: a temporary outage ends green with a
      // warning, unless the route has had no success for too long (then red).
      const limitHours = STALE_AFTER_HOURS[route] ?? 48;
      const last = error.lastSuccessAt;
      const ageHours = last === null ? null : Math.max(0, now() - last) / HOUR_MS;
      if (ageHours !== null && ageHours <= limitHours) {
        const message = `${route}: provider unavailable (${error.provider}) after retries; work deferred to the next scheduled run. Last successful run ${new Date(last).toISOString()} (${ageHours.toFixed(1)} h ago, limit ${limitHours} h).`;
        log(`::warning::${message}`);
        appendSummary(`- ⚠️ ${message}`);
        return 0;
      }
      const message = last === null
        ? `${route}: provider unavailable (${error.provider}) and no successful run on record; failing so a prolonged breakage is noticed.`
        : `${route}: provider unavailable (${error.provider}); last successful run ${new Date(last).toISOString()} is ${ageHours.toFixed(1)} h old, over the ${limitHours} h limit.`;
      errorLog(`::error::${message}`);
      appendSummary(`- ❌ ${message} The run failed.`);
      return 1;
    }
    const message = error instanceof CronInvocationError ? error.message : "Cron invocation failed.";
    errorLog(`::error::${message}`);
    appendSummary(`- ❌ \`${typeof route === "string" && ROUTES.has(route) ? route : "cron"}\` failed: ${message}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await runCronCommand(process.argv.slice(2), process.env);
}
