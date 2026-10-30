import assert from "node:assert/strict";
import { test } from "node:test";
import { invokeCron, runCronCommand } from "./invoke-cron.mjs";

const configuration = {
  siteUrl: "https://fixture.invalid",
  secret: "synthetic-cron-secret",
  route: "rss-sync",
};
const healthy = () =>
  Response.json({ ok: true, route: "rss-sync", durationMs: 12 });

test("cron caller authenticates one request, refuses redirects and validates its report", async () => {
  let calls = 0;
  const result = await invokeCron({
    ...configuration,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.href, "https://fixture.invalid/api/cron/rss-sync");
      assert.equal(
        options.headers.Authorization,
        "Bearer synthetic-cron-secret",
      );
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      assert.equal(options.method, "GET");
      assert.ok(options.signal instanceof AbortSignal);
      return healthy();
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    route: "rss-sync",
    degraded: false,
    continuation: false,
    durationMs: 12,
    lastSuccessAt: null,
  });
});

test("invalid origin, missing token and unknown route fail before any transport", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return healthy();
  };
  for (const siteUrl of [
    undefined,
    "",
    "http://fixture.invalid",
    "https://user:password@fixture.invalid",
    "https://fixture.invalid/path",
    "https://fixture.invalid?token=hidden",
    "https://fixture.invalid#hidden",
  ]) {
    await assert.rejects(
      invokeCron({ ...configuration, siteUrl, fetchImpl }),
      /APEX_SITE_URL/,
    );
  }
  for (const secret of [undefined, "", "   ", "secret\r\ninjected"]) {
    await assert.rejects(
      invokeCron({ ...configuration, secret, fetchImpl }),
      /CRON_SECRET/,
    );
  }
  await assert.rejects(
    invokeCron({ ...configuration, route: "../newsletter-blast", fetchImpl }),
    /Choose/,
  );
  assert.equal(calls, 0);
});

test("authentication failures, redirects and failed HTTP responses are failures without retries", async () => {
  for (const status of [301, 302, 401, 403, 404, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(
      invokeCron({
        ...configuration,
        fetchImpl: async () => {
          calls++;
          return new Response("private upstream payload", {
            status,
            headers: { Location: "https://elsewhere.invalid" },
          });
        },
      }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(calls, 1);
  }
});

test("HTTP 200 requires JSON, literal success and the expected route", async () => {
  for (const response of [
    new Response("<html>login</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    new Response("broken-json", {
      headers: { "Content-Type": "application/json" },
    }),
    Response.json({ ok: false, route: "rss-sync", error: "private payload" }),
    Response.json({ ok: "true", route: "rss-sync" }),
    Response.json({ ok: true, route: "weather-sync" }),
    Response.json([]),
    Response.json(null),
  ]) {
    await assert.rejects(
      invokeCron({ ...configuration, fetchImpl: async () => response }),
      /JSON|expected route/,
    );
  }
});

test("timeout covers both a stalled fetch and a stalled response body", async () => {
  let fetchSignal;
  await assert.rejects(
    invokeCron({
      ...configuration,
      timeoutMs: 20,
      fetchImpl: async (_url, options) => {
        fetchSignal = options.signal;
        return new Promise(() => {});
      },
    }),
    /deadline/,
  );
  assert.equal(fetchSignal.aborted, true);
  let bodyCancelled = false;
  const body = new ReadableStream({
    cancel() {
      bodyCancelled = true;
    },
  });
  await assert.rejects(
    invokeCron({
      ...configuration,
      timeoutMs: 20,
      fetchImpl: async () =>
        new Response(body, { headers: { "Content-Type": "application/json" } }),
    }),
    /deadline/,
  );
  assert.equal(bodyCancelled, true);
});

test("response size is bounded with or without a declared content length", async () => {
  for (const declared of [false, true]) {
    const body = JSON.stringify({
      ok: true,
      route: "rss-sync",
      privatePayload: "x".repeat(100),
    });
    await assert.rejects(
      invokeCron({
        ...configuration,
        maxResponseBytes: 80,
        fetchImpl: async () =>
          new Response(body, {
            headers: {
              "Content-Type": "application/json",
              ...(declared ? { "Content-Length": String(body.length) } : {}),
            },
          }),
      }),
      /size limit/,
    );
  }
});

test("degraded success emits a warning but never prints response fields or transport details", async () => {
  const output = [];
  const options = {
    log: (text) => output.push(text),
    errorLog: (text) => output.push(text),
    // A dropped connection is retried (cron resilience); no real waiting in tests.
    sleep: async () => {},
  };
  const env = {
    APEX_SITE_URL: configuration.siteUrl,
    CRON_SECRET: configuration.secret,
  };
  const code = await runCronCommand(["rss-sync"], env, {
    ...options,
    fetchImpl: async () =>
      Response.json({
        ok: true,
        route: "rss-sync",
        degraded: true,
        lastSuccessAt: new Date(Date.now() - 3_600_000).toISOString(),
        durationMs: 20,
        error: configuration.secret,
        sources: ["https://private.invalid?apiKey=private"],
      }),
  });
  assert.equal(code, 0);
  assert.ok(output.some((text) => text.startsWith("::warning::")));
  assert.doesNotMatch(
    output.join("\n"),
    /synthetic-cron-secret|private\.invalid|apiKey|sources/,
  );
  output.length = 0;
  assert.equal(
    await runCronCommand(["rss-sync"], env, {
      ...options,
      fetchImpl: async () => {
        throw new Error(`${configuration.secret} private exception details`);
      },
    }),
    1,
  );
  assert.doesNotMatch(
    output.join("\n"),
    /synthetic-cron-secret|private exception/,
  );
});

test("weather skipped within a healthy route report succeeds and malformed arguments fail", async () => {
  const output = [];
  const options = {
    log: (text) => output.push(text),
    errorLog: (text) => output.push(text),
  };
  assert.equal(
    await runCronCommand(
      ["weather-sync"],
      {
        APEX_SITE_URL: configuration.siteUrl,
        CRON_SECRET: configuration.secret,
      },
      {
        ...options,
        fetchImpl: async () =>
          Response.json({
            ok: true,
            route: "weather-sync",
            skipped: "No in-range forecasts.",
          }),
      },
    ),
    0,
  );
  assert.equal(await runCronCommand([], {}, options), 1);
  assert.equal(
    await runCronCommand(["rss-sync", "weather-sync"], {}, options),
    1,
  );
});

test("season catch-up: deferred rounds are a notice, a failed season sync fails the run", async () => {
  const output = [];
  const options = { log: (text) => output.push(text), errorLog: (text) => output.push(text) };
  const env = { APEX_SITE_URL: configuration.siteUrl, CRON_SECRET: configuration.secret };
  assert.equal(
    await runCronCommand(["jolpica-nightly"], env, {
      ...options,
      fetchImpl: async (url) => {
        assert.equal(new URL(url).pathname, "/api/cron/jolpica-nightly");
        return Response.json({ ok: true, route: "jolpica-nightly", complete: false, continuation: true });
      },
    }),
    0,
  );
  assert.match(output.join("\n"), /::notice::jolpica-nightly deferred/);
  assert.equal(
    await runCronCommand(["jolpica-nightly"], env, {
      ...options,
      fetchImpl: async () => Response.json({ ok: false, route: "jolpica-nightly" }, { status: 500 }),
    }),
    1,
  );
  assert.equal(await runCronCommand(["newsletter-blast"], env, options), 1);
});

test("--until-complete continues a deferred season fill, stops when complete, never retries a failure", async () => {
  const env = { APEX_SITE_URL: configuration.siteUrl, CRON_SECRET: configuration.secret };
  const output = [];
  const options = { log: (text) => output.push(text), errorLog: (text) => output.push(text) };
  let calls = 0;
  const reports = [true, true, false];
  assert.equal(
    await runCronCommand(["jolpica-nightly", "--until-complete=6"], env, {
      ...options,
      fetchImpl: async () => { const continuation = reports[calls++]; return Response.json({ ok: true, route: "jolpica-nightly", continuation }); },
    }),
    0,
  );
  assert.equal(calls, 3, "stops at the first complete report");
  assert.doesNotMatch(output.join("\n"), /::notice::/);
  calls = 0;
  assert.equal(
    await runCronCommand(["jolpica-nightly", "--until-complete=2"], env, {
      ...options,
      fetchImpl: async () => { calls++; return Response.json({ ok: true, route: "jolpica-nightly", continuation: true }); },
    }),
    0,
  );
  assert.equal(calls, 2, "bounded by N");
  assert.match(output.join("\n"), /::notice::jolpica-nightly deferred/);
  calls = 0;
  assert.equal(
    await runCronCommand(["jolpica-nightly", "--until-complete=5"], env, {
      ...options,
      fetchImpl: async () => { calls++; return Response.json({ ok: false, route: "jolpica-nightly" }, { status: 503 }); },
    }),
    1,
  );
  assert.equal(calls, 1, "a failure is not retried");
  for (const flag of ["--until-complete=0", "--until-complete=13", "--until-complete", "--repeat=2"]) {
    assert.equal(await runCronCommand(["jolpica-nightly", flag], env, options), 1);
  }
  assert.equal(await runCronCommand(["newsletter-blast", "--until-complete=2"], env, options), 1);
});

test("weekend-watch and youtube-sync are schedulable; newsletter-blast never is", async () => {
  for (const route of ["weekend-watch", "youtube-sync"]) {
    const result = await invokeCron({ ...configuration, route, fetchImpl: async (url) => { assert.equal(new URL(url).pathname, `/api/cron/${route}`); return Response.json({ ok: true, route, skipped: "nothing due" }); } });
    assert.equal(result.route, route);
  }
  await assert.rejects(invokeCron({ ...configuration, route: "newsletter-blast", fetchImpl: async () => assert.fail("no request") }), /Choose/);
});

// Cron resilience (2026-10-31): a Jolpica outage during the Mexico City weekend failed every
// scheduled run red. Provider outages are retried, then end green with a warning while the
// route's last success is recent, and red once it is too old. Anything else stays red at once.
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-31T12:00:00Z");
const outageReport = (route, lastSuccessAt) =>
  Response.json(
    { ok: false, route, retryable: true, reason: "provider-unavailable", provider: "jolpica", lastSuccessAt, error: "private upstream detail" },
    { status: 503, headers: { "Retry-After": "120" } },
  );
function harness(responses) {
  const output = [];
  const summary = [];
  const sleeps = [];
  let calls = 0;
  const options = {
    log: (text) => output.push(text),
    errorLog: (text) => output.push(text),
    appendSummary: (text) => summary.push(text),
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => NOW,
    fetchImpl: async () => {
      const next = responses[Math.min(calls++, responses.length - 1)];
      return typeof next === "function" ? next() : next.clone();
    },
  };
  return { options, output, summary, sleeps, calls: () => calls };
}
const cronEnv = { APEX_SITE_URL: configuration.siteUrl, CRON_SECRET: configuration.secret };

test("provider outage: retried with bounded backoff, then green with a warning while the last success is recent", async () => {
  const lastSuccessAt = new Date(NOW - 5 * HOUR).toISOString();
  const run = harness([outageReport("weather-sync", lastSuccessAt)]);
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 0);
  assert.equal(run.calls(), 3, "three attempts in all");
  assert.deepEqual(run.sleeps, [30_000, 90_000]);
  const text = run.output.join("\n");
  assert.match(text, /::warning::weather-sync: provider unavailable \(jolpica\)/);
  assert.match(text, /2026-10-31T07:00:00\.000Z/);
  assert.doesNotMatch(text, /::error::|private upstream detail|synthetic-cron-secret/);
  assert.equal(run.summary.length, 1);
  assert.match(run.summary[0], /provider unavailable/);
});

test("provider outage that clears on a retry is a plain success", async () => {
  const run = harness([outageReport("weekend-watch", new Date(NOW - HOUR).toISOString()), Response.json({ ok: true, route: "weekend-watch" })]);
  assert.equal(await runCronCommand(["weekend-watch"], cronEnv, run.options), 0);
  assert.equal(run.calls(), 2);
  assert.doesNotMatch(run.output.join("\n"), /::warning::|::error::/);
});

test("provider outage with a stale or unknown last success fails red (48 h weather/weekend, 72 h season)", async () => {
  for (const [route, hoursAgo, expected] of [
    ["weather-sync", 49, 1], ["weekend-watch", 121, 1], ["weekend-watch", 119, 0],
    ["jolpica-nightly", 60, 0], ["jolpica-nightly", 73, 1],
    ["weather-sync", null, 1],
  ]) {
    const run = harness([outageReport(route, hoursAgo === null ? null : new Date(NOW - hoursAgo * HOUR).toISOString())]);
    assert.equal(await runCronCommand([route], cronEnv, run.options), expected, `${route} ${hoursAgo}`);
    if (expected === 1) {
      assert.match(run.output.join("\n"), /::error::.*(no successful run|last successful run)/);
      assert.match(run.summary.join("\n"), /failed/);
    }
  }
});

test("a malformed or future lastSuccessAt cannot keep an outage green", async () => {
  for (const value of ["yesterday", new Date(NOW + 2 * HOUR).toISOString(), 12345]) {
    const run = harness([outageReport("weather-sync", value)]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1);
  }
  // A 503 that is not a well-formed outage report for this route is an ordinary failure, not retried.
  for (const response of [
    Response.json({ ok: false, route: "weather-sync", error: "Job ownership unavailable" }, { status: 503 }),
    outageReport("rss-sync", new Date(NOW - HOUR).toISOString()),
    new Response("<html>busy</html>", { status: 503, headers: { "Content-Type": "text/html" } }),
  ]) {
    const run = harness([response]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1);
    assert.equal(run.calls(), 1);
  }
});

test("our bugs, auth and config errors fail red at once without retries", async () => {
  for (const status of [400, 401, 403, 404, 500]) {
    const run = harness([Response.json({ ok: false, route: "weather-sync", retryable: true, reason: "provider-unavailable", lastSuccessAt: new Date(NOW).toISOString() }, { status })]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1, `HTTP ${status}`);
    assert.equal(run.calls(), 1, `HTTP ${status} is not retried`);
    assert.deepEqual(run.sleeps, []);
  }
});

test("gateway errors and dropped connections are retried, but never end green without an outage report", async () => {
  const gateway = harness([new Response("", { status: 504 })]);
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, gateway.options), 1);
  assert.equal(gateway.calls(), 3);
  const recovered = harness([() => { throw new TypeError("fetch failed"); }, Response.json({ ok: true, route: "weather-sync" })]);
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, recovered.options), 0);
  assert.equal(recovered.calls(), 2);
});

test("retries stay inside the run budget", async () => {
  let clock = NOW;
  const run = harness([outageReport("weather-sync", new Date(NOW - HOUR).toISOString())]);
  run.options.now = () => clock;
  run.options.sleep = async (ms) => { run.sleeps.push(ms); clock += ms; };
  run.options.budgetMs = 2 * 60_000;
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 0);
  // 30 s wait + a 65 s request fits in 2 minutes once; the 90 s wait after it does not.
  assert.equal(run.calls(), 2, "only the retries that fit the budget are tried");
  assert.deepEqual(run.sleeps, [30_000]);
});

test("season catch-up: an outage mid-way keeps earlier progress and follows the 72 h rule", async () => {
  const run = harness([
    Response.json({ ok: true, route: "jolpica-nightly", continuation: true }),
    outageReport("jolpica-nightly", new Date(NOW - 10 * HOUR).toISOString()),
  ]);
  assert.equal(await runCronCommand(["jolpica-nightly", "--until-complete=8"], cronEnv, run.options), 0);
  assert.equal(run.calls(), 4, "one success, then three attempts at the deferred continuation");
  assert.match(run.output.join("\n"), /::warning::jolpica-nightly: provider unavailable/);
});

test("a loopback http origin is accepted for local checks; any other http origin is not", async () => {
  for (const siteUrl of ["http://localhost:3000", "http://127.0.0.1:3100"]) {
    const result = await invokeCron({ ...configuration, siteUrl, fetchImpl: async (url) => { assert.equal(new URL(url).protocol, "http:"); return healthy(); } });
    assert.equal(result.route, "rss-sync");
  }
  for (const siteUrl of ["http://fixture.invalid", "http://localhost.evil.invalid", "http://10.0.0.1"])
    await assert.rejects(invokeCron({ ...configuration, siteUrl, fetchImpl: async () => healthy() }), /APEX_SITE_URL/);
});

// ---------- Owner hardening (2026-10-31): our own site failing, timing and clock edges ----------
test("staleness threshold edges: 47 h 59 vs 48 h 01 (weather/weekend), 71 h 59 vs 72 h 01 (season)", async () => {
  for (const [route, hours, expected] of [
    ["weather-sync", 47 + 59 / 60, 0], ["weather-sync", 48 + 1 / 60, 1],
    ["weekend-watch", 119 + 59 / 60, 0], ["weekend-watch", 120 + 1 / 60, 1],
    ["rss-sync", 48 + 1 / 60, 1], ["youtube-sync", 47 + 59 / 60, 0],
    ["jolpica-nightly", 71 + 59 / 60, 0], ["jolpica-nightly", 72 + 1 / 60, 1],
  ]) {
    const run = harness([outageReport(route, new Date(NOW - hours * HOUR).toISOString())]);
    assert.equal(await runCronCommand([route], cronEnv, run.options), expected, `${route} ${hours.toFixed(3)} h`);
  }
  // A lastSuccessAt slightly in the future (runner clock behind the server) is tolerated up to 5 minutes.
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, harness([outageReport("weather-sync", new Date(NOW + 4 * 60_000).toISOString())]).options), 0);
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, harness([outageReport("weather-sync", new Date(NOW + 6 * 60_000).toISOString())]).options), 1);
});

test("our own site down (DNS, refused, Vercel 502/504) is retried and then RED, never masked as a provider outage", async () => {
  for (const failure of [
    () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); },
    () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); },
    () => new Response("An error occurred with your deployment\n\nFUNCTION_INVOCATION_FAILED", { status: 502, headers: { "Content-Type": "text/plain" } }),
    () => new Response("FUNCTION_INVOCATION_TIMEOUT", { status: 504, headers: { "Content-Type": "text/plain" } }),
  ]) {
    const run = harness([failure]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1);
    assert.equal(run.calls(), 3, "retried");
    assert.match(run.output.join("\n"), /::error::/);
    assert.doesNotMatch(run.output.join("\n"), /::warning::/);
    assert.match(run.summary.join("\n"), /failed/);
  }
  // Our function's own 500, Vercel's 503 page and a 503 JSON without the outage contract: red at once.
  for (const response of [
    Response.json({ ok: false, route: "weather-sync", error: "TypeError" }, { status: 500 }),
    new Response("<html>DEPLOYMENT_PAUSED</html>", { status: 503, headers: { "Content-Type": "text/html" } }),
    Response.json({ ok: false, route: "weather-sync", reason: "provider-unavailable" }, { status: 503 }),
  ]) {
    const run = harness([response]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1);
    assert.equal(run.calls(), 1);
  }
});

test("malformed reports are red: invalid JSON, wrong route, missing ok, oversized", async () => {
  for (const response of [
    new Response("{\"ok\":tr", { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response("{\"ok\":false,\"retryable\":tr", { status: 503, headers: { "Content-Type": "application/json" } }),
    Response.json({ ok: true, route: "rss-sync" }),
    Response.json({ route: "weather-sync" }),
    new Response(JSON.stringify({ ok: true, route: "weather-sync", pad: "x".repeat(70_000) }), { status: 200, headers: { "Content-Type": "application/json" } }),
  ]) {
    const run = harness([response]);
    assert.equal(await runCronCommand(["weather-sync"], cronEnv, run.options), 1);
    assert.equal(run.calls(), 1);
  }
});

test("fake clock: worst-case retries and continuations end inside every refresh workflow's timeout", async () => {
  const { readFile } = await import("node:fs/promises");
  const { RUN_BUDGET_MS, REQUEST_TIMEOUT_MS } = await import("./invoke-cron.mjs");
  const SETUP_MS = 2 * 60_000; // checkout + setup-node, generous
  for (const [file, args] of [
    ["refresh-weather.yml", ["weather-sync"]], ["refresh-weekend.yml", ["weekend-watch"]], ["refresh-news.yml", ["rss-sync"]],
    ["refresh-videos.yml", ["youtube-sync"]], ["refresh-season.yml", ["jolpica-nightly", "--until-complete=8"]],
  ]) {
    const yaml = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    const timeoutMs = Number(/timeout-minutes: (\d+)/.exec(yaml)[1]) * 60_000;
    for (const scenario of ["outage", "continuation"]) {
      let clock = NOW;
      const run = harness([]);
      run.options.now = () => clock;
      run.options.sleep = async (ms) => { clock += ms; };
      // Every request takes the full 65 s deadline before it answers.
      run.options.fetchImpl = async () => {
        clock += REQUEST_TIMEOUT_MS;
        return scenario === "outage" ? outageReport(args[0], new Date(clock - HOUR).toISOString()) : Response.json({ ok: true, route: args[0], continuation: true });
      };
      assert.equal(await runCronCommand(args, cronEnv, run.options), 0, `${file} ${scenario}`);
      const elapsed = clock - NOW;
      assert.ok(elapsed <= RUN_BUDGET_MS + REQUEST_TIMEOUT_MS, `${file} ${scenario}: ${elapsed} ms`);
      assert.ok(elapsed + SETUP_MS <= timeoutMs, `${file} ${scenario}: ${elapsed} ms + setup exceeds ${timeoutMs} ms`);
    }
  }
});

test("review F-02: a degraded 200 warns only while the last FULL success is recent; stale or unknown is red", async () => {
  const degraded = (route, lastSuccessAt) => Response.json({ ok: true, route, degraded: true, lastSuccessAt });
  for (const [route, hours, expected] of [["weather-sync", 5, 0], ["weather-sync", 49, 1], ["weather-sync", null, 1], ["jolpica-nightly", 71, 0], ["rss-sync", 60, 1]]) {
    const run = harness([degraded(route, hours === null ? null : new Date(NOW - hours * HOUR).toISOString())]);
    assert.equal(await runCronCommand([route], cronEnv, run.options), expected, `${route} ${hours}`);
    assert.equal(run.calls(), 1, "a degraded 200 is never retried");
    assert.match(run.output.join("\n"), expected === 0 ? /::warning::/ : /::error::.*(no full success|last full success)/);
  }
  // A plain (not degraded) 200 needs no lastSuccessAt.
  assert.equal(await runCronCommand(["weather-sync"], cronEnv, harness([Response.json({ ok: true, route: "weather-sync" })]).options), 0);
});

test("review F-05: weekend-watch tolerates its Monday-to-Friday gap (120 h); the others keep 48/72 h", async () => {
  const { STALE_AFTER_HOURS } = await import("./invoke-cron.mjs");
  assert.equal(STALE_AFTER_HOURS["weekend-watch"], 120);
  // Monday 06:54 success, Friday 00:04 first run with Jolpica down: 89 h later is still a warning.
  const run = harness([outageReport("weekend-watch", new Date(NOW - 89 * HOUR).toISOString())]);
  assert.equal(await runCronCommand(["weekend-watch"], cronEnv, run.options), 0);
  assert.equal(await runCronCommand(["weekend-watch"], cronEnv, harness([outageReport("weekend-watch", new Date(NOW - 121 * HOUR).toISOString())]).options), 1);
});
