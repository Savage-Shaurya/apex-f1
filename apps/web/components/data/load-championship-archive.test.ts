import "next/dist/server/node-environment";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import {
  workAsyncStorage,
  type WorkStore,
} from "next/dist/server/app-render/work-async-storage.external";
import { jolpica } from "@apex/api-client/jolpica";
import { ProviderError } from "../../../../packages/api-client/src/transport";
import {
  loadConstructorChampionshipArchive,
  loadDriverChampionshipArchive,
} from "./load-championship-archive";
import { CHAMPIONSHIP_SNAPSHOT_THROUGH } from "@/lib/championship-snapshot";

const driver = {
  position: "1",
  positionText: "1",
  points: "30",
  wins: "3",
  Driver: { driverId: "fixture", givenName: "Fixture", familyName: "Winner" },
  Constructors: [{ constructorId: "fixture", name: "Fixture Team" }],
};
const constructor = {
  position: "1",
  positionText: "1",
  points: "30",
  wins: "3",
  Constructor: { constructorId: "fixture", name: "Fixture Team" },
};

/** Exercise the live per-season path for every season (no snapshot rows). */
const LIVE = { snapshotThrough: 0 } as const;

test("seasons covered by the snapshot load complete with zero provider reads", async (t) => {
  let calls = 0;
  for (const method of ["getDriverChampionSnapshot", "getConstructorChampionSnapshot"] as const)
    t.mock.method(jolpica, method, async () => {
      calls++;
      throw new Error("Unexpected provider read");
    });
  const drivers = await loadDriverChampionshipArchive(CHAMPIONSHIP_SNAPSHOT_THROUGH);
  const teams = await loadConstructorChampionshipArchive(CHAMPIONSHIP_SNAPSHOT_THROUGH);
  assert.equal(calls, 0);
  assert.equal(drivers.state, "complete");
  assert.equal(drivers.records.length, CHAMPIONSHIP_SNAPSHOT_THROUGH - 1950 + 1);
  assert.equal(teams.records.length, CHAMPIONSHIP_SNAPSHOT_THROUGH - 1958 + 1);
  assert.deepEqual(drivers.records.map((row) => row.year), Array.from({ length: drivers.records.length }, (_, i) => CHAMPIONSHIP_SNAPSHOT_THROUGH - i));
  const byYear = new Map(drivers.records.map((row) => [row.year, row.winner.Driver.driverId]));
  assert.equal(byYear.get(1950), "farina");
  assert.equal(byYear.get(1964), "surtees");
  assert.equal(byYear.get(1988), "senna");
  const teamByYear = new Map(teams.records.map((row) => [row.year, row.winner.Constructor.constructorId]));
  assert.equal(teamByYear.get(1958), "vanwall");
  assert.equal(teamByYear.get(1959), "cooper-climax");
  assert.equal(teamByYear.get(1978), "team_lotus");
});

test("seasons after the snapshot are read live and merged newest first; a failed live season stays missing", async (t) => {
  const storage = nextStorage(t);
  let calls = 0;
  let fail = true;
  t.mock.method(jolpica, "getDriverChampionSnapshot", async (year: number) => {
    calls++;
    if (fail) throw new ProviderError("jolpica", "http", 429);
    return { season: String(year), round: 12, standings: [driver] };
  });
  const through = 1953;
  const partial = await loadDriverChampionshipArchive(through, { snapshotThrough: 1951 });
  assert.equal(partial.state, "partial");
  assert.deepEqual(partial.missing, [1953, 1952]);
  assert.deepEqual(partial.records.map((row) => row.year), [1951, 1950]);
  assert.equal(storage.entries.size, 0);
  fail = false;
  const complete = await loadDriverChampionshipArchive(through, { snapshotThrough: 1951 });
  assert.equal(complete.state, "complete");
  assert.deepEqual(complete.records.map((row) => row.year), [1953, 1952, 1951, 1950]);
  assert.equal(complete.records[0]?.winner.Driver.driverId, "fixture");
  assert.equal(complete.records[2]?.winner.Driver.driverId, "fangio");
  assert.equal(calls, 4);
});

test("archive rejects seasons outside the championship range", async () => {
  await assert.rejects(loadConstructorChampionshipArchive(1957), ProviderError);
  // The current year is accepted once lastCompletedSeason() reaches it (lib/season.ts); a future season never is.
  await assert.rejects(loadDriverChampionshipArchive(new Date().getUTCFullYear() + 1), ProviderError);
  await assert.rejects(loadConstructorChampionshipArchive(new Date().getUTCFullYear() + 1), ProviderError);
});
type Entry = {
  value: { kind: string; data: { body: string }; revalidate: number };
  tags: string[];
};

/** Exercise the installed Next unstable_cache implementation with an isolated
 * storage adapter. This makes no provider/file/database request. */
function nextStorage(t: TestContext) {
  const entries = new Map<string, Entry>();
  let stale = false;
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "__incrementalCache",
  );
  Object.defineProperty(globalThis, "__incrementalCache", {
    configurable: true,
    value: {
      generateSimpleCacheKey: async (key: string) => key,
      get: async (key: string) =>
        entries.has(key)
          ? { value: entries.get(key)!.value, isStale: stale }
          : null,
      set: async (
        key: string,
        value: Entry["value"],
        context: { tags: string[] },
      ) => {
        entries.set(key, { value, tags: context.tags });
      },
    },
  });
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis, "__incrementalCache", original);
    else Reflect.deleteProperty(globalThis, "__incrementalCache");
  });
  return {
    entries,
    setStale: (value: boolean) => {
      stale = value;
    },
  };
}

test("actual Next function cache fills both complete cold archives and warm archives make zero provider calls within TTL", async (t) => {
  const storage = nextStorage(t);
  let calls = 0;
  t.mock.method(jolpica, "getDriverChampionSnapshot", async (year: number) => {
    calls++;
    return { season: String(year), round: 12, standings: [driver] };
  });
  t.mock.method(
    jolpica,
    "getConstructorChampionSnapshot",
    async (year: number) => {
      calls++;
      return { season: String(year), round: 12, standings: [constructor] };
    },
  );
  const through = new Date().getUTCFullYear() - 1;
  const cold = await Promise.all([
    loadDriverChampionshipArchive(through, LIVE),
    loadConstructorChampionshipArchive(through, LIVE),
  ]);
  assert.equal(cold[0].state, "complete");
  assert.equal(cold[1].state, "complete");
  assert.equal(calls, through - 1950 + 1 + through - 1958 + 1);
  const coldCalls = calls;
  const warm = await Promise.all([
    loadDriverChampionshipArchive(through, LIVE),
    loadConstructorChampionshipArchive(through, LIVE),
  ]);
  assert.deepEqual(warm, cold);
  assert.equal(calls, coldCalls);
  for (const entry of storage.entries.values()) {
    assert.equal(entry.value.revalidate, 604800);
    const body = JSON.parse(entry.value.data.body);
    assert.ok(Number.isFinite(Date.parse(body.observedAt)));
    assert.equal(body.round, 12);
    assert.ok(body.source.includes(`/${body.season}/`));
    assert.ok(body.source.endsWith("/1.json"));
    assert.ok(entry.tags.includes(`jolpica:season:${body.season}`));
  }
});

test("empty, outage and malformed winner results never persist and can immediately recover", async (t) => {
  const storage = nextStorage(t);
  let calls = 0;
  t.mock.method(
    jolpica,
    "getConstructorChampionSnapshot",
    async (year: number) => {
      calls++;
      if (calls === 1) return { season: null, round: null, standings: [] };
      if (calls === 2) throw new ProviderError("jolpica", "http", 429);
      if (calls === 3) throw new ProviderError("jolpica", "invalid-response");
      return { season: String(year), round: 12, standings: [constructor] };
    },
  );
  assert.equal((await loadConstructorChampionshipArchive(1958, LIVE)).state, "empty");
  assert.equal(storage.entries.size, 0);
  assert.equal(
    (await loadConstructorChampionshipArchive(1958, LIVE)).state,
    "unavailable",
  );
  assert.equal(storage.entries.size, 0);
  assert.equal(
    (await loadConstructorChampionshipArchive(1958, LIVE)).state,
    "unavailable",
  );
  assert.equal(storage.entries.size, 0);
  assert.equal(
    (await loadConstructorChampionshipArchive(1958, LIVE)).state,
    "complete",
  );
  assert.equal(storage.entries.size, 1);
  assert.equal(
    (await loadConstructorChampionshipArchive(1958, LIVE)).state,
    "complete",
  );
  assert.equal(calls, 4);
});

test("expired verified cache refreshes a correction and failed refresh preserves only the previous verified entry", async (t) => {
  const storage = nextStorage(t);
  let calls = 0;
  let fail = false;
  t.mock.method(jolpica, "getDriverChampionSnapshot", async (year: number) => {
    calls++;
    if (fail) throw new ProviderError("jolpica", "invalid-response");
    return {
      season: String(year),
      round: 12,
      standings: [{ ...driver, points: String(30 + calls) }],
    };
  });
  const first = await loadDriverChampionshipArchive(1950, LIVE);
  assert.equal(first.records[0]?.winner.points, "31");
  storage.setStale(true);
  const corrected = await loadDriverChampionshipArchive(1950, LIVE);
  assert.equal(corrected.records[0]?.winner.points, "32");
  const verifiedBody = [...storage.entries.values()][0]!.value.data.body;
  fail = true;
  assert.equal(
    (await loadDriverChampionshipArchive(1950, LIVE)).state,
    "unavailable",
  );
  assert.equal([...storage.entries.values()][0]!.value.data.body, verifiedBody);
  storage.setStale(false);
  assert.equal(
    (await loadDriverChampionshipArchive(1950, LIVE)).records[0]?.winner.points,
    "32",
  );
  assert.equal(calls, 3);
});

test("actual cached adapter propagates the remaining archive deadline to queued provider work and then recovers", async (t) => {
  const storage = nextStorage(t);
  let calls = 0;
  let providerSignal: AbortSignal | undefined;
  t.mock.method(
    jolpica,
    "getDriverChampionSnapshot",
    async (
      year: number,
      options: { timeoutMs: number; deadlineMs: number; signal: AbortSignal },
    ) => {
      calls++;
      providerSignal = options.signal;
      assert.equal(options.deadlineMs, options.timeoutMs);
      if (calls === 1) {
        // The 25 ms archive budget reaches the queued provider read.
        assert.ok(options.timeoutMs <= 25);
        return new Promise<never>(() => {});
      }
      return { season: String(year), round: 12, standings: [driver] };
    },
  );
  const startedAt = performance.now();
  const first = await loadDriverChampionshipArchive(1950, { ...LIVE, budgetMs: 25 });
  assert.equal(first.state, "unavailable");
  assert.equal(storage.entries.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(providerSignal?.aborted, true);
  assert.equal(calls, 1);
  assert.ok(performance.now() - startedAt < 500);
  // Recovery uses an ordinary budget: a 25 ms one could expire on a loaded CI machine before the
  // immediate mock answer is processed (the flake seen once in a full parallel run).
  assert.equal(
    (await loadDriverChampionshipArchive(1950, { ...LIVE, budgetMs: 30_000 })).state,
    "complete",
  );
  assert.equal(calls, 2);
  assert.equal(storage.entries.size, 1);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const archiveKinds = [
  {
    kind: "driver",
    method: "getDriverChampionSnapshot",
    year: 1950,
    winner: driver,
    load: loadDriverChampionshipArchive,
  },
  {
    kind: "constructor",
    method: "getConstructorChampionSnapshot",
    year: 1958,
    winner: constructor,
    load: loadConstructorChampionshipArchive,
  },
] as const;

for (const { kind, method, year, winner, load } of archiveKinds) {
  test(`${kind} archive caller abort cancels its cache fill and an ignored abort cannot persist a late winner`, async (t) => {
    const storage = nextStorage(t);
    const started = deferred<void>();
    const response = deferred<{
      season: string;
      round: number;
      standings: Array<typeof winner>;
    }>();
    let calls = 0;
    let providerSignal: AbortSignal | undefined;
    t.mock.method(
      jolpica,
      method,
      async (_year: number, options: { signal: AbortSignal }) => {
        calls++;
        providerSignal = options.signal;
        if (calls === 1) {
          started.resolve();
          return response.promise;
        }
        return { season: String(year), round: 12, standings: [winner] };
      },
    );
    const controller = new AbortController();
    const first = load(year, { ...LIVE, budgetMs: 30_000, signal: controller.signal });
    await started.promise;
    controller.abort();
    assert.equal((await first).state, "unavailable");
    assert.equal(providerSignal?.aborted, true);
    assert.equal(storage.entries.size, 0);
    response.resolve({ season: String(year), round: 12, standings: [winner] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(storage.entries.size, 0);
    const recovered = await load(year, LIVE);
    assert.equal(recovered.state, "complete");
    assert.equal(storage.entries.size, 1);
    assert.equal(calls, 2);
    assert.deepEqual(await load(year, LIVE), recovered);
    assert.equal(calls, 2);
    const preAborted = new AbortController();
    preAborted.abort();
    assert.equal(
      (await load(year, { ...LIVE, signal: preAborted.signal })).state,
      "unavailable",
    );
    assert.equal(calls, 2);
    assert.equal(storage.entries.size, 1);
  });

  test(`${kind} archive cancellation does not cancel another caller filling the same cache key`, async (t) => {
    const storage = nextStorage(t);
    const bothStarted = deferred<void>();
    const responses = [
      deferred<{
        season: string;
        round: number;
        standings: Array<typeof winner>;
      }>(),
      deferred<{
        season: string;
        round: number;
        standings: Array<typeof winner>;
      }>(),
    ];
    const signals: AbortSignal[] = [];
    let calls = 0;
    t.mock.method(
      jolpica,
      method,
      async (_year: number, options: { signal: AbortSignal }) => {
        const index = calls++;
        signals.push(options.signal);
        if (calls === 2) bothStarted.resolve();
        return responses[index]!.promise;
      },
    );
    const controller = new AbortController();
    const first = load(year, { ...LIVE, budgetMs: 30_000, signal: controller.signal });
    const second = load(year, { ...LIVE, budgetMs: 30_000 });
    await bothStarted.promise;
    controller.abort();
    assert.equal((await first).state, "unavailable");
    assert.equal(signals[0]?.aborted, true);
    assert.equal(signals[1]?.aborted, false);
    const snapshot = { season: String(year), round: 12, standings: [winner] };
    responses[0]!.resolve(snapshot);
    responses[1]!.resolve(snapshot);
    const success = await second;
    assert.equal(success.state, "complete");
    assert.equal(storage.entries.size, 1);
    assert.deepEqual(await load(year, LIVE), success);
    assert.equal(calls, 2);
  });

  test(`${kind} archive serving a stale winner does not cancel Next's bounded background correction`, async (t) => {
    const storage = nextStorage(t);
    const background = deferred<{
      season: string;
      round: number;
      standings: Array<typeof winner>;
    }>();
    let calls = 0;
    let providerSignal: AbortSignal | undefined;
    t.mock.method(
      jolpica,
      method,
      async (_year: number, options: { signal: AbortSignal }) => {
        calls++;
        if (calls === 1)
          return { season: String(year), round: 12, standings: [winner] };
        providerSignal = options.signal;
        return background.promise;
      },
    );
    const original = await load(year, LIVE);
    storage.setStale(true);
    // Use the installed App Router work store branch: this returns the cached
    // value while recording a pending background revalidation promise.
    const work = {
      isStaticGeneration: false,
      page: "/champions/page",
      route: "/champions",
      nextFetchId: 1,
    } as unknown as WorkStore;
    const stale = await workAsyncStorage.run(work, () => load(year, LIVE));
    assert.deepEqual(stale, original);
    assert.equal(calls, 2);
    assert.equal(providerSignal?.aborted, false);
    assert.equal(Object.keys(work.pendingRevalidates ?? {}).length, 1);
    background.resolve({
      season: String(year),
      round: 12,
      standings: [{ ...winner, points: "99" }],
    });
    await Promise.all(Object.values(work.pendingRevalidates ?? {}));
    storage.setStale(false);
    assert.equal((await load(year, LIVE)).records[0]?.winner.points, "99");
    assert.equal(calls, 2);
    assert.equal(storage.entries.size, 1);
  });
}
