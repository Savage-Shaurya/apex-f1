import path from "node:path";
import { pathToFileURL } from "node:url";

// newsletter-blast is deliberately absent: it sends real email and only the hosting cron may call it.
const ROUTES = new Set(["rss-sync", "weather-sync", "jolpica-nightly", "weekend-watch", "youtube-sync"]);
/** Upper bound for `--until-complete=N` (each run is one bounded cron request). */
const MAX_CONTINUATIONS = 12;
const REQUEST_TIMEOUT_MS = 65_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

class CronInvocationError extends Error {}

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
  if (
    origin.protocol !== "https:" ||
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

/** One bounded invocation. No retry: a timed-out request may already have executed. */
export async function invokeCron({
  siteUrl,
  secret,
  route,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
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
        if (response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          throw new CronInvocationError(
            `Cron returned HTTP ${response.status}.`,
          );
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
    if (controller.signal.aborted)
      throw new CronInvocationError("Cron request exceeded its deadline.");
    if (error instanceof CronInvocationError) throw error;
    // Fetch exceptions can include a URL, token or upstream payload. Never print them.
    throw new CronInvocationError(
      "Cron transport failed before a valid report was received.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function runCronCommand(
  args,
  env,
  {
    fetchImpl = fetch,
    log = console.log,
    errorLog = console.error,
    timeoutMs,
    maxResponseBytes,
  } = {},
) {
  try {
    // `<route>` or `<route> --until-complete=N`: a report with continuation:true
    // (work deferred at the time budget, e.g. a fresh season fill) is followed by
    // another request, at most N in all. A failure is never retried.
    if (args.length < 1 || args.length > 2)
      throw new CronInvocationError("Pass exactly one cron route.");
    let runs = 1;
    if (args.length === 2) {
      const match = /^--until-complete=(\d{1,2})$/.exec(args[1]);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > MAX_CONTINUATIONS)
        throw new CronInvocationError("Pass exactly one cron route.");
      runs = Number(match[1]);
    }
    for (let run = 1; run <= runs; run++) {
      const result = await invokeCron({
        siteUrl: env.APEX_SITE_URL,
        secret: env.CRON_SECRET,
        route: args[0],
        fetchImpl,
        timeoutMs,
        maxResponseBytes,
      });
      log(
        `[cron] ${result.route} -> HTTP 200; report ok${result.durationMs === null ? "" : `; duration ${result.durationMs}ms`}${runs > 1 ? `; run ${run} of at most ${runs}` : ""}`,
      );
      if (result.degraded)
        log(
          `::warning::${result.route} completed with degraded provider availability.`,
        );
      if (!result.continuation) break;
      if (run === runs)
        log(
          `::notice::${result.route} deferred some work within its time budget; the next scheduled run continues it.`,
        );
    }
    return 0;
  } catch (error) {
    errorLog(
      `::error::${error instanceof CronInvocationError ? error.message : "Cron invocation failed."}`,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await runCronCommand(process.argv.slice(2), process.env);
}
