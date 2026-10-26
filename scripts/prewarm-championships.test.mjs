import assert from "node:assert/strict";
import { test } from "node:test";
import {
  prewarmChampionships,
  runPrewarmCommand,
  verifyArchiveHtml,
} from "./prewarm-championships.mjs";

const through = new Date().getUTCFullYear() - 1;
function html(kind, omit, suffix = "") {
  const from = kind === "drivers" ? 1950 : 1958;
  const anchors = Array.from(
    { length: through - from + 1 },
    (_, index) => from + index,
  )
    .filter((year) => year !== omit)
    .map(
      (year) =>
        `<a href="/results/${year}/${kind}"><span>${year}</span><span>30 pts</span><p class="font-display">Verified Winner</p><span>3 wins</span></a>`,
    )
    .join("");
  return `<html><body><a href="/results/${through + 1}/${kind}">Current standings</a><h2 id="wall-title">Completed championships · year by year</h2>${anchors}${suffix}</body></html>`;
}
const response = (body) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
const source = async (url) =>
  response(html(url.pathname.startsWith("/drivers") ? "drivers" : "teams"));

test("prewarm reads only the two real routes sequentially, without identity or redirects, and verifies stable full records", async () => {
  const calls = [];
  let active = 0;
  const result = await prewarmChampionships({
    origin: "http://127.0.0.1:3520",
    fetchImpl: async (url, options) => {
      assert.equal(active++, 0);
      assert.equal(url.origin, "http://127.0.0.1:3520");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      assert.deepEqual(options.headers, { Accept: "text/html" });
      calls.push(url.pathname);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return source(url);
    },
  });
  assert.deepEqual(calls, [
    "/drivers/champions",
    "/drivers/champions",
    "/teams/champions",
    "/teams/champions",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.requests, 4);
  assert.deepEqual(
    result.results.map((item) => item.records),
    [through - 1949, through - 1949, through - 1957, through - 1957],
  );
  assert.equal(result.sharedCacheVerified, false);
  assert.equal(result.trueColdProviderCostRemoved, false);
});

test("rejects unsafe origins, injected identity and invalid limits before any request", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response("");
  };
  for (const origin of [
    undefined,
    "",
    "http://example.invalid",
    "https://user:password@example.invalid",
    "https://example.invalid/path",
    "https://example.invalid?token=secret",
    "https://example.invalid#secret",
    "file:///tmp",
  ]) {
    await assert.rejects(prewarmChampionships({ origin, fetchImpl }));
  }
  for (const invalid of [
    { through: through - 1 },
    { requestMs: 40001 },
    { runMs: 100001 },
    { maxBytes: 8388609 },
    { maxWarmMs: 2001 },
    { maxBytes: NaN },
  ]) {
    await assert.rejects(
      prewarmChampionships({
        origin: "https://example.invalid",
        fetchImpl,
        ...invalid,
      }),
    );
  }
  assert.equal(calls, 0);
});

test("counts actual complete-year anchors and ignores current navigation and RSC script duplicates", () => {
  const complete = html("drivers");
  const duplicate = `<script>"${complete.replaceAll('"', '\\"')}"</script><!--${complete}--><a href="/results/1950/drivers">Past standings navigation</a>`;
  assert.deepEqual(
    verifyArchiveHtml(complete + duplicate, "drivers", through),
    verifyArchiveHtml(complete, "drivers", through),
  );
});

test("shell-only, missing, duplicate and detail-free completed records fail readiness", () => {
  for (const body of [
    "<html><body>Champions of Formula 1 Loading completed championship records</body></html>",
    html("drivers", 1950),
    html(
      "drivers",
      undefined,
      '<a href="/results/1950/drivers">1950 30 pts <p class="font-display">Verified Winner</p> 3 wins</a>',
    ),
    html("drivers").replace("30 pts", "Unknown points"),
    html("drivers").replace('<p class="font-display">Verified Winner</p>', ""),
  ])
    assert.throws(() => verifyArchiveHtml(body, "drivers", through));
});

test("React may deliver a secondary win span in a later streamed fragment while winner identity and points remain real anchor markup", () => {
  const complete = html("drivers").replace(
    "<span>3 wins</span>",
    '<template id="P:2"></template>',
  );
  assert.deepEqual(
    verifyArchiveHtml(
      complete +
        '<div hidden id="S:2"><span>3 wins</span></div><script>$RS("S:2","P:2")</script>',
      "drivers",
      through,
    ),
    verifyArchiveHtml(html("drivers"), "drivers", through),
  );
});

test("explicit partial states and server render failures cannot pass even with complete anchors", () => {
  for (const suffix of [
    "The archive is incomplete for 1950.",
    "Championship records are unavailable.",
    '<template data-dgst="error"></template>',
    "<!--$!-->",
  ]) {
    assert.throws(() =>
      verifyArchiveHtml(html("drivers", undefined, suffix), "drivers", through),
    );
  }
});

test("direct HTTP status, HTML type and unexpected session failures stop without retries", async () => {
  for (const failure of [
    new Response("", {
      status: 302,
      headers: { location: "https://other.invalid" },
    }),
    new Response("", { status: 500 }),
    Response.json({ ok: true }),
    new Response(html("drivers"), {
      headers: { "content-type": "text/html", "set-cookie": "opaque=fixture" },
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      prewarmChampionships({
        origin: "https://fixture.invalid",
        fetchImpl: async () => {
          calls++;
          return failure;
        },
      }),
    );
    assert.equal(calls, 1);
  }
});

test("redirected or cross-origin fetch results fail even if a transport ignored manual redirects", async () => {
  const redirected = response(html("drivers"));
  Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      fetchImpl: async () => redirected,
    }),
  );
  const foreign = response(html("drivers"));
  Object.defineProperty(foreign, "url", {
    value: "https://foreign.invalid/drivers/champions",
  });
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      fetchImpl: async () => foreign,
    }),
  );
});

test("stream and announced size ceilings stop oversized responses and cancel their readers", async () => {
  const announced = response(html("drivers"));
  announced.headers.set("content-length", "1000");
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      maxBytes: 100,
      fetchImpl: async () => announced,
    }),
  );
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(101));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      maxBytes: 100,
      fetchImpl: async () =>
        new Response(stream, { headers: { "content-type": "text/html" } }),
    }),
  );
  assert.equal(cancelled, true);
});

test("header stalls are bounded even if an injected transport ignores abort", async () => {
  let signal;
  const started = performance.now();
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      requestMs: 20,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    }),
  );
  assert.equal(signal.aborted, true);
  assert.ok(performance.now() - started < 1000);
});

test("body stalls are bounded and cancel the reader after headers arrive", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      requestMs: 20,
      fetchImpl: async () =>
        new Response(stream, { headers: { "content-type": "text/html" } }),
    }),
  );
  assert.equal(cancelled, true);
});

test("malformed UTF-8 is rejected instead of comparing replaced text", async () => {
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      fetchImpl: async () => response(new Uint8Array([0xc3, 0x28])),
    }),
  );
});

test("changed championship record between initial and warm reads blocks readiness", async () => {
  let calls = 0;
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      fetchImpl: async () =>
        response(
          html("drivers").replace(
            "Verified Winner",
            ++calls === 1 ? "First Winner" : "Corrected Winner",
          ),
        ),
    }),
  );
  assert.equal(calls, 2);
});

test("slow complete warm body fails the chosen readiness limit", async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      now: () => clock,
      fetchImpl: async (url) => {
        calls++;
        clock += calls === 2 ? 2001 : 10;
        return source(url);
      },
    }),
  );
  assert.equal(calls, 2);
});

test("run deadline stops further routes even when the individual response completed", async () => {
  let clock = 0;
  let calls = 0;
  await assert.rejects(
    prewarmChampionships({
      origin: "https://fixture.invalid",
      runMs: 50,
      now: () => clock,
      fetchImpl: async (url) => {
        calls++;
        clock += 51;
        return source(url);
      },
    }),
  );
  assert.equal(calls, 1);
});

test("CLI never prints unexpected transport errors or supplied credentials", async () => {
  const stdout = [];
  const stderr = [];
  assert.equal(
    await runPrewarmCommand(
      ["--origin", "https://fixture.invalid"],
      async () => {
        throw new Error("SECRET_IN_PROVIDER_ERROR");
      },
      (value) => stdout.push(value),
      (value) => stderr.push(value),
    ),
    1,
  );
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "Archive readiness failed; inspect the instance logs.",
  ]);
  let calls = 0;
  assert.equal(
    await runPrewarmCommand(
      [
        "--origin",
        "https://fixture.invalid",
        "--origin",
        "https://other.invalid",
      ],
      async () => {
        calls++;
      },
      () => {},
      () => {},
    ),
    1,
  );
  assert.equal(calls, 0);
});
