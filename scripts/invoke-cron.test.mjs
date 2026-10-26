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
