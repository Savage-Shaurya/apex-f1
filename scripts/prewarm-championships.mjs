import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_MS = 40_000;
const MAX_RUN_MS = 100_000;
const MAX_WARM_MS = 2_000;
const ROUTES = [
  { path: "/drivers/champions", kind: "drivers", from: 1950 },
  { path: "/teams/champions", kind: "teams", from: 1958 },
];

class PrewarmError extends Error {}
function targetOrigin(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new PrewarmError("A single explicit instance origin is required.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    target.hostname,
  );
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    !(target.protocol === "https:" || (target.protocol === "http:" && loopback))
  ) {
    throw new PrewarmError(
      "Use HTTPS or loopback HTTP, without credentials, path, query or fragment.",
    );
  }
  return target;
}

/** Inspect actual anchor markup, excluding script-encoded RSC duplicates and
 * current-year navigation. Records must include their year, points and winner
 * identity. React may deliver the secondary win-count span separately from
 * its parent anchor. A shell, partial archive or duplicate years cannot pass. */
export function verifyArchiveHtml(html, kind, through) {
  const route = ROUTES.find((item) => item.kind === kind);
  if (
    !route ||
    !Number.isSafeInteger(through) ||
    through < route.from ||
    through >= new Date().getUTCFullYear()
  ) {
    throw new PrewarmError("Completed archive year or kind is invalid.");
  }
  if (typeof html !== "string" || /data-dgst\s*=|<!--\$!-->/i.test(html))
    throw new PrewarmError("Server render failed.");
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  if (
    /The archive is incomplete for|championship records are unavailable|No completed (?:constructor )?championship records/i.test(
      markup,
    )
  ) {
    throw new PrewarmError("Archive is incomplete or unavailable.");
  }
  if (
    !/Completed championships\s*(?:·|&middot;|&#183;)\s*year by year/.test(
      markup,
    )
  )
    throw new PrewarmError("Completed archive wall is absent.");
  const records = [];
  for (const match of markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const yearMatch = href?.match(new RegExp(`^/results/(\\d{4})/${kind}$`));
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    if (year > through) continue;
    if (year < route.from)
      throw new PrewarmError(
        "Archive includes an unsupported historical year.",
      );
    const text = match[2]
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const points = text.match(/(\d+(?:\.\d+)?)\s+pts\b/i)?.[1];
    // The named champion is a display paragraph in the actual ChampionWall.
    // Secondary team/win spans can be relocated by React streaming and are
    // excluded from identity comparison to avoid false correction alarms.
    const winner = [...match[2].matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi)]
      .filter((paragraph) =>
        /\bclass\s*=\s*(["'])[^"']*\bfont-display\b[^"']*\1/i.test(
          paragraph[1],
        ),
      )
      .map((paragraph) =>
        paragraph[2]
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    if (
      !new RegExp(`(?:^|\\s)${year}(?:\\s|$)`).test(text) ||
      !points ||
      winner.length !== 1 ||
      !/\p{L}{2}/u.test(winner[0])
    ) {
      // A navigation link can point at a completed season too. Only actual
      // championship tiles carry all these details; incomplete tiles then
      // fail the complete unique-year coverage check below.
      continue;
    }
    records.push({ year, href, winner: winner[0], points });
  }
  const expected = through - route.from + 1;
  const years = new Set(records.map((record) => record.year));
  if (
    records.length !== expected ||
    years.size !== expected ||
    Array.from({ length: expected }, (_, index) => route.from + index).some(
      (year) => !years.has(year),
    )
  ) {
    throw new PrewarmError(
      "Archive does not contain each completed season exactly once.",
    );
  }
  records.sort((a, b) => a.year - b.year);
  return {
    records: expected,
    through,
    recordSha256: createHash("sha256")
      .update(JSON.stringify(records))
      .digest("hex"),
  };
}

async function readHtml(response, signal, maxBytes) {
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes)
    throw new PrewarmError("HTML exceeds the size limit.");
  if (!response.body)
    throw new PrewarmError("Archive response has no streamed body.");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted)
        throw new PrewarmError("Archive request exceeded its deadline.");
      const chunk = await reader.read();
      if (signal.aborted)
        throw new PrewarmError("Archive request exceeded its deadline.");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        cancel();
        throw new PrewarmError("HTML exceeds the size limit.");
      }
      chunks.push(chunk.value);
    }
    const body = Buffer.concat(chunks, bytes);
    try {
      return {
        html: new TextDecoder("utf-8", { fatal: true }).decode(body),
        bytes,
      };
    } catch {
      throw new PrewarmError("Archive HTML has invalid UTF-8.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function readRoute(origin, route, through, phase, dependencies, expires) {
  const started = dependencies.now();
  const timeout = Math.min(dependencies.requestMs, expires - started);
  if (timeout < 1)
    throw new PrewarmError("Prewarm run exceeded its total budget.");
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PrewarmError("Archive request exceeded its deadline."));
    }, timeout);
  });
  let response;
  try {
    return await Promise.race([
      deadline,
      (async () => {
        const url = new URL(route.path, origin);
        response = await dependencies.fetchImpl(url, {
          method: "GET",
          headers: { Accept: "text/html" },
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted)
          throw new PrewarmError("Archive request exceeded its deadline.");
        const headersMs = dependencies.now() - started;
        if (
          response.status !== 200 ||
          response.redirected ||
          (response.url && response.url !== url.href)
        )
          throw new PrewarmError(
            "Archive must return HTTP 200 directly from the addressed instance.",
          );
        if (response.headers.has("set-cookie"))
          throw new PrewarmError(
            "Public archive unexpectedly creates a session.",
          );
        if (
          !/^text\/html(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        )
          throw new PrewarmError("Archive response must be HTML.");
        const body = await readHtml(
          response,
          controller.signal,
          dependencies.maxBytes,
        );
        const fullBodyMs = dependencies.now() - started;
        const archive = verifyArchiveHtml(body.html, route.kind, through);
        if (controller.signal.aborted || dependencies.now() >= expires)
          throw new PrewarmError("Prewarm run exceeded its total budget.");
        if (phase === "warm" && fullBodyMs > dependencies.maxWarmMs)
          throw new PrewarmError(
            "Complete warm archive exceeds the readiness latency limit.",
          );
        return {
          path: route.path,
          phase,
          headersMs,
          fullBodyMs,
          bytes: body.bytes,
          ...archive,
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (response?.body && !response.body.locked)
      void response.body.cancel().catch(() => {});
  }
}

/** Explicit deployment readiness operation: four sequential real page reads,
 * no automatic retry or provider/cache modification. One addressed instance
 * only; this never claims a load-balanced fleet has a shared warm cache. */
export async function prewarmChampionships({
  origin,
  through = new Date().getUTCFullYear() - 1,
  fetchImpl = fetch,
  now = () => performance.now(),
  requestMs = MAX_REQUEST_MS,
  runMs = MAX_RUN_MS,
  maxBytes = MAX_BODY_BYTES,
  maxWarmMs = MAX_WARM_MS,
} = {}) {
  const target = targetOrigin(origin);
  if (
    !Number.isSafeInteger(through) ||
    through !== new Date().getUTCFullYear() - 1 ||
    !Number.isFinite(requestMs) ||
    requestMs < 1 ||
    requestMs > MAX_REQUEST_MS ||
    !Number.isFinite(runMs) ||
    runMs < 1 ||
    runMs > MAX_RUN_MS ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_BODY_BYTES ||
    !Number.isFinite(maxWarmMs) ||
    maxWarmMs < 1 ||
    maxWarmMs > MAX_WARM_MS
  )
    throw new PrewarmError("Prewarm limits or completed year are invalid.");
  const started = now();
  const expires = started + runMs;
  const results = [];
  const dependencies = { fetchImpl, now, requestMs, maxBytes, maxWarmMs };
  for (const route of ROUTES) {
    const initial = await readRoute(
      target,
      route,
      through,
      "initial",
      dependencies,
      expires,
    );
    const warm = await readRoute(
      target,
      route,
      through,
      "warm",
      dependencies,
      expires,
    );
    if (warm.recordSha256 !== initial.recordSha256)
      throw new PrewarmError(
        "Championship records changed during readiness verification.",
      );
    results.push(initial, warm);
  }
  return {
    ok: true,
    instanceOrigin: target.origin,
    through,
    requests: results.length,
    fullRunMs: now() - started,
    maxWarmMs,
    explicitlyAddressedInstanceOnly: true,
    sharedCacheVerified: false,
    trueColdProviderCostRemoved: false,
    results,
  };
}

export async function runPrewarmCommand(
  argv,
  invoke = prewarmChampionships,
  stdout = console.log,
  stderr = console.error,
) {
  try {
    if (argv.length !== 2 || argv[0] !== "--origin")
      throw new PrewarmError(
        "Usage: node scripts/prewarm-championships.mjs --origin INSTANCE_ORIGIN",
      );
    stdout(JSON.stringify(await invoke({ origin: argv[1] }), null, 2));
    return 0;
  } catch (error) {
    stderr(
      error instanceof PrewarmError
        ? error.message
        : "Archive readiness failed; inspect the instance logs.",
    );
    return 1;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = await runPrewarmCommand(process.argv.slice(2));
}
