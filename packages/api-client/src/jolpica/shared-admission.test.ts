import assert from "node:assert/strict";
import { test } from "node:test";
import { JolpicaRequestControl } from "./request-control";
import { ProviderError } from "../transport";
import {
  createJolpicaSharedAdmission,
  invalidateSharedJolpicaChampionships,
  jolpicaRedisConfig,
  JOLPICA_COMPLETE_SCRIPT,
  JOLPICA_RESERVE_SCRIPT,
} from "./shared-admission";

const config = {
  url: "https://fixture.upstash.io",
  token: "offline-fixture-token",
};
const signal = () => new AbortController().signal;

test("shared configuration refuses foreign origins, partial secrets and credential-bearing URLs", () => {
  assert.deepEqual(
    jolpicaRedisConfig({
      UPSTASH_REDIS_REST_URL: config.url,
      UPSTASH_REDIS_REST_TOKEN: config.token,
    }),
    config,
  );
  for (const url of [
    "http://fixture.upstash.io",
    "https://fixture.invalid",
    "https://user:password@fixture.upstash.io",
    "https://fixture.upstash.io/path",
    "https://fixture.upstash.io?secret=fixture",
    "https://fixture.upstash.io:444",
  ]) {
    assert.equal(
      jolpicaRedisConfig({
        UPSTASH_REDIS_REST_URL: url,
        UPSTASH_REDIS_REST_TOKEN: config.token,
      }),
      null,
    );
  }
  assert.equal(
    jolpicaRedisConfig({ UPSTASH_REDIS_REST_URL: config.url }),
    null,
  );
});

test("reservation and completion use one hash slot, Redis TIME and exact-owner CAS without deleting quota", async () => {
  const seen: string[][] = [];
  const store = createJolpicaSharedAdmission(config, {
    // The production deployment's keys (other environments are scoped, redis-scope-keys.test.ts).
    env: { VERCEL_ENV: "production" },
    fetch: async (_url, options) => {
      const command = JSON.parse(String(options?.body));
      seen.push(command);
      assert.equal(options?.cache, "no-store");
      assert.equal(options?.redirect, "error");
      return Response.json({
        result: command[1] === JOLPICA_RESERVE_SCRIPT ? [1, 0, 35000] : 1,
      });
    },
  });
  const result = await store.reserve("owner-one", signal());
  assert.equal(result.admitted, true);
  assert.ok(result.remainingMs <= 34990);
  await store.complete("owner-one", signal());
  assert.equal(seen[0]![1], JOLPICA_RESERVE_SCRIPT);
  assert.equal(seen[1]![1], JOLPICA_COMPLETE_SCRIPT);
  assert.equal(seen[1]![2], "1");
  assert.equal(seen[1]![3], "apex:jolpica:v1:{jolpica}:dispatches");
  assert.equal(seen[0]![2], "4");
  assert.ok(seen[0]!.slice(3, 7).every((key) => key.startsWith("apex:jolpica:v1:{jolpica}:")));
  assert.ok(JOLPICA_RESERVE_SCRIPT.includes("redis.call('TIME')"));
  // Completion removes only this owner's lease, never another request's.
  assert.equal(JOLPICA_COMPLETE_SCRIPT, "redis.call('ZREM',KEYS[1],ARGV[1]); return 1");
});

test("reservation subtracts full transport round trip from the lease instead of trusting a delayed acknowledgment", async () => {
  let clock = 0;
  const store = createJolpicaSharedAdmission(config, {
    monotonic: () => clock,
    fetch: async () => {
      clock += 34999;
      return Response.json({ result: [1, 0, 35000] });
    },
  });
  const result = await store.reserve("delayed-owner", signal());
  assert.equal(result.remainingMs, 0);
});

test("malformed Redis shapes and upstream errors fail closed", async () => {
  for (const value of [
    [1, 10, 35000],
    [0, 0, 0],
    [1, 0, 40000],
    [0, 3600002, 0],
    [1],
    "ok",
    null,
  ]) {
    const store = createJolpicaSharedAdmission(config, {
      fetch: async () => Response.json({ result: value }),
    });
    await assert.rejects(store.reserve("owner-one", signal()), ProviderError);
  }
  const store = createJolpicaSharedAdmission(config, {
    fetch: async () =>
      Response.json({ error: "OPAQUE_PRIVATE_PROVIDER_ERROR" }),
  });
  await assert.rejects(
    store.reserve("owner-one", signal()),
    (error) =>
      error instanceof ProviderError && !error.message.includes("OPAQUE"),
  );
});

test("an explicitly required but missing shared store starts zero provider requests; a failing store degrades to local pacing (Redis optional, 2026-10-31)", async () => {
  let calls = 0;
  const required = new JolpicaRequestControl({ requireShared: true, sharedAdmission: null });
  await assert.rejects(required.readThrough("fixture", 0, {}, async () => { calls++; return "should not run"; }));
  assert.equal(calls, 0);
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = new JolpicaRequestControl({
      sharedAdmission: { reserve: async () => { throw new ProviderError("jolpica", "configuration"); }, complete: async () => {} },
    });
    assert.equal(await failing.readThrough("fixture", 0, {}, async () => { calls++; return "local"; }), "local");
  } finally { console.warn = warn; }
  assert.equal(calls, 1);
});

test("cold shared read consumes admission once, warm process cache consumes none, fresh reads consume another", async () => {
  let reserves = 0;
  let completes = 0;
  let physical = 0;
  const sharedAdmission = {
    reserve: async () => {
      reserves++;
      return { admitted: true, retryMs: 0, remainingMs: 35000 };
    },
    complete: async () => {
      completes++;
    },
  };
  let now = 1000;
  const control = new JolpicaRequestControl({
    sharedAdmission,
    requireShared: true,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  const operation = async () => {
    physical++;
    return { value: physical };
  };
  assert.deepEqual(await control.readThrough("fixture", 60, {}, operation), {
    value: 1,
  });
  assert.deepEqual(await control.readThrough("fixture", 60, {}, operation), {
    value: 1,
  });
  assert.deepEqual(await control.readThrough("fixture", 0, {}, operation), {
    value: 2,
  });
  assert.deepEqual([reserves, completes, physical], [2, 2, 2]);
});

// Production 2026-10-26: with three shared dispatch slots, timed-out reads that kept their
// 35 s lease starved every other read (driver and team pages answered 500). An aborted
// fetch has closed its connection, and Jolpica's limits count starts (quota and gap).
test("network failures and timed-out transports release their dispatch lease at once", async () => {
  let completed = 0;
  const sharedAdmission = {
    reserve: async () => ({ admitted: true, retryMs: 0, remainingMs: 35000 }),
    complete: async () => {
      completed++;
    },
  };
  const control = new JolpicaRequestControl({ sharedAdmission });
  await assert.rejects(
    control.readThrough("fixture", 60, {}, async () => {
      throw new ProviderError("jolpica", "network");
    }),
  );
  assert.equal(completed, 1);
  const fresh = new JolpicaRequestControl({ sharedAdmission });
  await assert.rejects(
    fresh.readThrough(
      "fixture",
      0,
      { timeoutMs: 20 },
      // Like fetch, the transport rejects once its signal aborts.
      (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ProviderError("jolpica", "timeout")))),
    ),
  );
  assert.equal(completed, 2);
});

test("BE-1: a finished failed request (5xx, bad schema) releases its lease, so the next read is not blocked", async () => {
  let completed = 0;
  let backoffs = 0;
  const sharedAdmission = {
    reserve: async () => ({ admitted: true, retryMs: 0, remainingMs: 35000 }),
    complete: async () => { completed++; },
    backoff: async () => { backoffs++; },
  };
  for (const error of [new ProviderError("jolpica", "http", 503), new ProviderError("jolpica", "invalid-response"), new ProviderError("jolpica", "incomplete")]) {
    const control = new JolpicaRequestControl({ sharedAdmission });
    await assert.rejects(control.readThrough("fixture", 60, {}, async () => { throw error; }));
  }
  assert.equal(completed, 3);
  assert.equal(backoffs, 0);
});

test("BE-1: a 429 keeps the lease and asks every process to back off for Retry-After", async () => {
  let completed = 0;
  const pauses: number[] = [];
  let now = 1000;
  const control = new JolpicaRequestControl({
    now: () => now,
    sleep: async (ms) => { now += ms; },
    sharedAdmission: {
      reserve: async () => ({ admitted: true, retryMs: 0, remainingMs: 35000 }),
      complete: async () => { completed++; },
      backoff: async (ms) => { pauses.push(ms); },
    },
  });
  await assert.rejects(control.readThrough("a", 60, {}, async () => { throw new ProviderError("jolpica", "http", 429, 120_000); }));
  assert.equal(completed, 0);
  assert.deepEqual(pauses, [120_000]);
  // Every key now fails fast without a physical request until Retry-After passes.
  let physical = 0;
  await assert.rejects(control.readThrough("b", 60, {}, async () => { physical++; return "x"; }), /rate-limit/);
  assert.equal(physical, 0);
  now += 120_001;
  assert.equal(await control.readThrough("b", 60, {}, async () => { physical++; return "x"; }), "x");
  assert.equal(physical, 1);
});

test("hourly quota denial and expired delayed reservations cannot start physical requests", async () => {
  let physical = 0;
  for (const reply of [
    { admitted: false, retryMs: 3600000, remainingMs: 0 },
    { admitted: true, retryMs: 0, remainingMs: 10 },
  ]) {
    const control = new JolpicaRequestControl({
      sharedAdmission: { reserve: async () => reply, complete: async () => {} },
    });
    await assert.rejects(
      control.readThrough("fixture", 0, { timeoutMs: 100 }, async () => {
        physical++;
        return "invalid";
      }),
    );
  }
  assert.equal(physical, 0);
});

test("current-season refresh changes no historical epoch; completed correction advances appropriate epochs atomically", async () => {
  const commands: string[][] = [];
  const options = {
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body));
      commands.push(command);
      return Response.json({ result: Number(command[2]) });
    },
  };
  await invalidateSharedJolpicaChampionships(
    new Date().getUTCFullYear(),
    config,
    options,
  );
  assert.equal(commands.length, 0);
  await invalidateSharedJolpicaChampionships(1950, config, options);
  assert.equal(commands[0]![2], "1");
  await invalidateSharedJolpicaChampionships(2025, config, options);
  assert.equal(commands[1]![2], "2");
  // A finished current season (after its December finale) is in the archive, so a correction advances epochs.
  await invalidateSharedJolpicaChampionships(new Date().getUTCFullYear(), config, { ...options, finished: true });
  assert.equal(commands[2]![2], "2");
  await invalidateSharedJolpicaChampionships(new Date().getUTCFullYear() + 1, config, { ...options, finished: true });
  assert.equal(commands.length, 3);
  assert.ok(
    commands
      .flat()
      .every(
        (value) => !value.endsWith(":quota") && !value.endsWith(":dispatch"),
      ),
  );
});

test("one failed read no longer blocks other keys: a healthy read right after a 503 succeeds", async () => {
  const control = new JolpicaRequestControl({
    sharedAdmission: {
      reserve: async () => ({ admitted: true, retryMs: 0, remainingMs: 35000 }),
      complete: async () => {},
    },
  });
  await assert.rejects(control.readThrough("broken", 60, {}, async () => { throw new ProviderError("jolpica", "http", 503); }));
  assert.equal(await control.readThrough("healthy", 60, { timeoutMs: 2_000 }, async () => "ok"), "ok");
});

test("starts are paced but physical reads overlap: three slow reads finish in about one read time", async () => {
  const control = new JolpicaRequestControl({});
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 600));
    inFlight--;
    return "ok";
  };
  const started = Date.now();
  await Promise.all(["a", "b", "c"].map((key) => control.readThrough(key, 60, { timeoutMs: 5_000 }, slow)));
  const elapsed = Date.now() - started;
  assert.equal(peak, 3);
  // Serial would be at least 1800 ms; overlapping is 600 ms plus two 260 ms start gaps.
  assert.ok(elapsed < 1_500, `elapsed ${elapsed}`);
});
