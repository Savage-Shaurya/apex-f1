import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { predictionAttemptPayloadHash } from '@apex/db';
import {
  PREDICTION_SUBMISSION_DEADLINE_MS, predictionFailureFeedback, predictionPayloadHash, submitPrediction,
} from './prediction-submission';
import { type PredictionAttempt, type PredictionAttemptStore, type PredictionIdentityLock } from './prediction-session';

const identity = '0ee712a1-d29a-4b76-bf24-323bb3f2521b';
const attemptId = '51f336c4-dd6c-412d-8b4e-d89be5cfe55b';
const revision = '2026-10-03 01:02:03.123456+00';
const input = { season: 2026, round: 2, raceSlug: 'fixture-race', picks: { winner: 'driver_a', pole: 'driver_b' }, expectedRevision: null };
const success = () => Response.json({ ok: true, current: true, replayed: false, revision });
const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function memoryStore(): PredictionAttemptStore {
  let entries: PredictionAttempt[] = [];
  return { read: () => jsonClone(entries), write: (next) => { entries = jsonClone(next); } };
}
function serialLock(): PredictionIdentityLock {
  let tail = Promise.resolve();
  return async (signal, task) => {
    const before = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try {
      if (signal.aborted) throw new Error('cancelled while queued');
      return await task();
    } finally { release(); }
  };
}
function readyFetch(write: typeof fetch): typeof fetch {
  return async (url, init) => String(url) === '/api/predict/identity'
    ? Response.json({ ok: true, identity }) : write(url, init);
}
function options(write: typeof fetch, store = memoryStore()) {
  return { fetchImpl: readyFetch(write), attemptStore: store, newAttemptId: () => attemptId };
}
async function settleSetup() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

test('prediction provisions then confirms its cookie before any mutation and captures exact revision/payload', async () => {
  const calls: string[] = [];
  let cookie: string | undefined;
  const result = await submitPrediction(input, {
    attemptStore: memoryStore(), identityLock: serialLock(), newAttemptId: () => attemptId,
    fetchImpl: async (url, init) => {
      calls.push(String(init?.method ?? 'GET') + ' ' + String(url));
      if (String(url) === '/api/predict/identity') {
        if (init?.method === 'POST') {
          assert.equal(init.body, '{}');
          cookie = identity;
          return Response.json({ ok: true, identity });
        }
        return cookie ? Response.json({ ok: true, identity: cookie }) : Response.json({ ok: false }, { status: 428 });
      }
      assert.equal(cookie, identity);
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('x-apex-prediction-identity'), identity);
      assert.equal(new Headers(init?.headers).get('x-apex-prediction-attempt'), attemptId);
      assert.deepEqual(JSON.parse(String(init?.body)), { ...input, picks: { pole: 'driver_b', winner: 'driver_a' } });
      return success();
    },
  });
  assert.deepEqual(result, { kind: 'accepted', revision });
  assert.deepEqual(calls, ['GET /api/predict/identity', 'POST /api/predict/identity', 'GET /api/predict/identity', 'POST /api/predict']);
});

test('a Set-Cookie response without subsequent browser cookie confirmation cannot save', async () => {
  let writes = 0, lookups = 0;
  const result = await submitPrediction(input, {
    attemptStore: memoryStore(), identityLock: serialLock(), newAttemptId: () => attemptId,
    fetchImpl: async (url, init) => {
      if (String(url) !== '/api/predict/identity') { writes++; return success(); }
      if (init?.method === 'POST') return Response.json({ ok: true, identity });
      lookups++;
      return Response.json({ ok: false }, { status: 428 });
    },
  });
  assert.equal(result.kind, 'unavailable');
  assert.match(predictionFailureFeedback(result as Exclude<typeof result, { kind: 'accepted' }>), /did not confirm.*No save/);
  assert.equal(writes, 0);
  assert.equal(lookups, 2);
});

test('fresh simultaneous tabs share one bootstrap identity through a cross-tab lock', async () => {
  const lock = serialLock();
  let cookie: string | undefined, creates = 0;
  const actors: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === '/api/predict/identity') {
      if (init?.method === 'POST') { creates++; cookie = identity; return Response.json({ ok: true, identity }); }
      return cookie ? Response.json({ ok: true, identity: cookie }) : Response.json({ ok: false }, { status: 428 });
    }
    actors.push(new Headers(init?.headers).get('x-apex-prediction-identity')!);
    return success();
  };
  const result = await Promise.all([
    submitPrediction(input, { fetchImpl, identityLock: lock, attemptStore: memoryStore(), newAttemptId: () => attemptId }),
    submitPrediction(input, { fetchImpl, identityLock: lock, attemptStore: memoryStore(), newAttemptId: () => '52f336c4-dd6c-412d-8b4e-d89be5cfe55b' }),
  ]);
  assert.equal(creates, 1);
  assert.deepEqual(actors, [identity, identity]);
  assert.ok(result.every((value) => value.kind === 'accepted'));
});

test('a browser without a cross-tab lock may use an existing identity but cannot create a new one', async () => {
  let creates = 0;
  const missing = await submitPrediction(input, {
    attemptStore: memoryStore(), newAttemptId: () => attemptId,
    fetchImpl: async (_, init) => { if (init?.method === 'POST') creates++; return Response.json({ ok: false }, { status: 428 }); },
  });
  assert.equal(missing.kind, 'unavailable');
  assert.equal(creates, 0);
  assert.deepEqual(await submitPrediction(input, options(async () => success())), { kind: 'accepted', revision });
});

test('lost bootstrap response leaves no picks and retry confirms the already issued cookie without another identity', async () => {
  let cookie: string | undefined, creates = 0, writes = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url) === '/api/predict/identity') {
      if (init?.method === 'POST') { creates++; cookie = identity; throw new TypeError('response lost'); }
      return cookie ? Response.json({ ok: true, identity: cookie }) : Response.json({ ok: false }, { status: 428 });
    }
    writes++;
    return success();
  };
  const config = { fetchImpl, identityLock: serialLock(), attemptStore: memoryStore(), newAttemptId: () => attemptId };
  assert.equal((await submitPrediction(input, config)).kind, 'unavailable');
  assert.equal(writes, 0);
  assert.deepEqual(await submitPrediction(input, config), { kind: 'accepted', revision });
  assert.equal(creates, 1);
  assert.equal(writes, 1);
});

test('an uncertain first save retains its identity, attempt, payload and original view revision across explicit retry/reload', async () => {
  const store = memoryStore();
  const sent: { body: unknown; headers: Headers }[] = [];
  let calls = 0;
  const config = options(async (_, init) => {
    sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    calls++;
    if (calls === 1) throw new TypeError('response lost after commit');
    return Response.json({ ok: true, current: true, replayed: true, revision });
  }, store);
  assert.deepEqual(await submitPrediction(input, config), { kind: 'uncertain', reason: 'network' });
  assert.equal(store.read().length, 1);
  assert.deepEqual(await submitPrediction({ ...input, expectedRevision: revision }, config), { kind: 'accepted', revision });
  assert.deepEqual(sent[0]!.body, sent[1]!.body, 'Reloaded revision never changes a replay request');
  assert.equal(sent[0]!.headers.get('x-apex-prediction-attempt'), sent[1]!.headers.get('x-apex-prediction-attempt'));
  assert.equal(sent[0]!.headers.get('x-apex-prediction-identity'), sent[1]!.headers.get('x-apex-prediction-identity'));
  assert.equal(store.read().length, 0);
});

test('caller changes during preparation cannot mutate the captured request', async () => {
  const mutable = jsonClone(input);
  let release!: (response: Response) => void;
  const pending = submitPrediction(mutable, {
    attemptStore: memoryStore(), newAttemptId: () => attemptId,
    fetchImpl: async (url, init) => {
      if (String(url) === '/api/predict/identity') return new Promise<Response>((resolve) => { release = resolve; });
      assert.deepEqual(JSON.parse(String(init?.body)).picks, { pole: 'driver_b', winner: 'driver_a' });
      return success();
    },
  });
  mutable.picks.winner = 'driver_c';
  release(Response.json({ ok: true, identity }));
  assert.deepEqual(await pending, { kind: 'accepted', revision });
});

test('changed picks require the exact earlier receipt before another write, never generic row confirmation', async () => {
  const store = memoryStore();
  await submitPrediction(input, options(async () => { throw new TypeError('lost'); }, store));
  let writes = 0;
  const result = await submitPrediction({ ...input, picks: { winner: 'driver_c' } }, {
    ...options(async (url) => {
      if (String(url).startsWith('/api/predict?')) return Response.json({ ok: true, identity, prediction: { picks: input.picks, revision }, receipt: null });
      writes++; return success();
    }, store),
  });
  assert.equal(result.kind, 'unavailable');
  assert.equal(writes, 0);
  assert.equal(store.read().length, 1);
});

test('a receipt for a different payload cannot clear an uncertain attempt', async () => {
  const store = memoryStore();
  await submitPrediction(input, options(async () => { throw new TypeError('lost'); }, store));
  const result = await submitPrediction({ ...input, picks: { winner: 'driver_c' } }, options(async () => Response.json({
    ok: true, identity, receipt: { outcome: 'applied', payloadHash: 'wrong' },
  }), store));
  assert.equal(result.kind, 'unavailable');
  assert.equal(store.read().length, 1);
});

test('an exact earlier receipt permits intentional changed picks using a new replay key', async () => {
  const store = memoryStore();
  await submitPrediction(input, options(async () => { throw new TypeError('lost'); }, store));
  let writes = 0;
  const nextId = '52f336c4-dd6c-412d-8b4e-d89be5cfe55b';
  const result = await submitPrediction({ ...input, picks: { winner: 'driver_c' }, expectedRevision: revision }, {
    ...options(async (url, init) => {
      if (String(url).startsWith('/api/predict?')) return Response.json({ ok: true, identity, receipt: { outcome: 'applied', payloadHash: predictionAttemptPayloadHash({ ...input, handle: null }) } });
      writes++;
      assert.equal(new Headers(init?.headers).get('x-apex-prediction-attempt'), nextId);
      assert.equal(JSON.parse(String(init?.body)).picks.winner, 'driver_c');
      return success();
    }, store), newAttemptId: () => nextId,
  });
  assert.deepEqual(result, { kind: 'accepted', revision });
  assert.equal(writes, 1);
  assert.equal(store.read().length, 0);
});

test('uncertain attempts do not silently acquire another cookie identity or provision a replacement', async () => {
  const store = memoryStore();
  await submitPrediction(input, options(async () => { throw new TypeError('lost'); }, store));
  for (const response of [Response.json({ ok: false }, { status: 428 }), Response.json({ ok: true, identity: '01e712a1-d29a-4b76-bf24-323bb3f2521b' })]) {
    let writes = 0;
    const result = await submitPrediction(input, { attemptStore: store, identityLock: serialLock(), fetchImpl: async (_, init) => {
      if (init?.method === 'POST') writes++;
      return response;
    } });
    assert.equal(result.kind, 'unavailable');
    assert.equal(writes, 0);
  }
});

test('race locking is distinct from revision/request conflict without changing the visual form', async () => {
  const locked = await submitPrediction(input, options(async () => Response.json({ ok: false, kind: 'race_locked', error: 'Picks are locked for this race.' }, { status: 409 })));
  assert.deepEqual(locked, { kind: 'rejected', status: 409, message: 'Picks are locked for this race.' });
  const conflict = await submitPrediction(input, options(async () => Response.json({ ok: false, kind: 'attempt_conflict', error: 'Another tab changed these picks.' }, { status: 409 })));
  assert.deepEqual(conflict, { kind: 'rejected', status: 412, message: 'Another tab changed these picks.' });
  assert.match(predictionFailureFeedback(conflict as Exclude<typeof conflict, { kind: 'accepted' }>), /Another tab/);
});

test('quota or identity rejection of an uncertain retry cannot discard its original replay key', async () => {
  for (const status of [429, 412, 428]) {
    const store = memoryStore();
    const keys: string[] = [];
    let call = 0;
    const config = options(async (_, init) => {
      keys.push(new Headers(init?.headers).get('x-apex-prediction-attempt')!);
      call++;
      if (call === 1) throw new TypeError('lost after commit');
      if (call === 2) return Response.json({ ok: false, kind: 'identity_mismatch' }, { status });
      return success();
    }, store);
    assert.equal((await submitPrediction(input, config)).kind, 'uncertain');
    assert.equal((await submitPrediction(input, config)).kind, 'rejected');
    assert.equal(store.read().length, 1);
    assert.equal((await submitPrediction(input, config)).kind, 'accepted');
    assert.deepEqual(keys, [attemptId, attemptId, attemptId]);
  }
});

test('old replay after a newer tab edit confirms the earlier attempt without claiming current picks saved', async () => {
  const result = await submitPrediction(input, options(async () => Response.json({ ok: true, current: false, replayed: true, revision })));
  assert.equal(result.kind, 'superseded');
  assert.match(predictionFailureFeedback(result as Exclude<typeof result, { kind: 'accepted' }>), /current picks.*Reload/);
});

test('successful responses need literal confirmation, current/replay status and an exact revision', async () => {
  for (const payload of [null, [], {}, { ok: true }, { ok: true, current: true, replayed: false, revision: 'bad' }]) {
    const store = memoryStore();
    const result = await submitPrediction(input, options(async () => Response.json(payload), store));
    assert.deepEqual(result, { kind: 'uncertain', reason: 'invalid-response' });
    assert.equal(store.read().length, 1);
  }
});

test('server errors preserve uncertainty and never automatically repeat a write', async () => {
  for (const status of [500, 502, 503]) {
    const store = memoryStore();
    let writes = 0;
    const result = await submitPrediction(input, options(async () => {
      writes++; return Response.json({ ok: false, error: 'Your picks were not saved.' }, { status });
    }, store));
    assert.equal(result.kind, 'rejected');
    assert.match(predictionFailureFeedback(result as Exclude<typeof result, { kind: 'accepted' }>), /may have been saved/);
    assert.doesNotMatch(predictionFailureFeedback(result as Exclude<typeof result, { kind: 'accepted' }>), /were not saved/);
    assert.equal(writes, 1);
    assert.equal(store.read().length, 1);
  }
});

test('a preparation timeout cannot send a late mutation after its result settled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (response: Response) => void, writes = 0;
  const pending = submitPrediction(input, { attemptStore: memoryStore(), fetchImpl: async (url) => {
    if (String(url) === '/api/predict/identity') return new Promise<Response>((resolve) => { finish = resolve; });
    writes++; return success();
  } });
  t.mock.timers.tick(PREDICTION_SUBMISSION_DEADLINE_MS);
  assert.equal((await pending).kind, 'unavailable');
  finish(Response.json({ ok: true, identity }));
  await settleSetup();
  assert.equal(writes, 0);
});

test('ignored preparation abort releases the bootstrap lock for the next tab', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const lock = serialLock();
  const stuck = submitPrediction(input, { attemptStore: memoryStore(), identityLock: lock,
    fetchImpl: () => new Promise<Response>(() => {}),
  });
  await settleSetup();
  t.mock.timers.tick(PREDICTION_SUBMISSION_DEADLINE_MS);
  assert.equal((await stuck).kind, 'unavailable');
  assert.deepEqual(await submitPrediction(input, { ...options(async () => success()), identityLock: lock }), { kind: 'accepted', revision });
});

test('ignored write abort settles at 20 seconds, retains the replay attempt and ignores late success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = memoryStore();
  let requestSignal: AbortSignal | null | undefined, finish!: (response: Response) => void;
  const pending = submitPrediction(input, options(async (_, init) => {
    requestSignal = init?.signal;
    return new Promise<Response>((resolve) => { finish = resolve; });
  }, store));
  await settleSetup();
  t.mock.timers.tick(PREDICTION_SUBMISSION_DEADLINE_MS);
  assert.deepEqual(await pending, { kind: 'uncertain', reason: 'timeout' });
  assert.equal(requestSignal?.aborted, true);
  assert.equal(store.read().length, 1);
  finish(success());
  assert.deepEqual(await pending, { kind: 'uncertain', reason: 'timeout' });
  assert.equal(store.read().length, 1);
});

test('the full deadline also bounds a stalled response body after upload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let decoding = false;
  const pending = submitPrediction(input, options(async () => ({
    ok: true, json: () => { decoding = true; return new Promise<unknown>(() => {}); },
  }) as Response));
  await settleSetup();
  assert.equal(decoding, true);
  t.mock.timers.tick(PREDICTION_SUBMISSION_DEADLINE_MS);
  assert.deepEqual(await pending, { kind: 'uncertain', reason: 'timeout' });
});

test('unmount prevents new requests and retains any already uploaded replay attempt', async () => {
  const controller = new AbortController(), store = memoryStore();
  let finish!: (response: Response) => void, attempts = 0;
  const pending = submitPrediction(input, { ...options(async () => {
    attempts++; return new Promise<Response>((resolve) => { finish = resolve; });
  }, store), signal: controller.signal });
  await settleSetup();
  controller.abort();
  assert.deepEqual(await pending, { kind: 'cancelled' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  finish(success());
  assert.equal(store.read().length, 1);
  assert.deepEqual(await submitPrediction(input, { ...options(async () => { attempts++; return success(); }), signal: controller.signal }), { kind: 'cancelled' });
  assert.equal(attempts, 1);
});

test('storage failure cannot upload a mutation without a retained replay key', async () => {
  let writes = 0;
  const result = await submitPrediction(input, { ...options(async () => { writes++; return success(); }),
    attemptStore: { read: () => [], write: () => { throw new Error('storage blocked'); } },
  });
  assert.equal(result.kind, 'unavailable');
  assert.equal(writes, 0);
});

test('successful submission releases timers and abort listeners', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  assert.deepEqual(await submitPrediction(input, { ...options(async (_, init) => { requestSignal = init?.signal; return success(); }), signal: controller.signal }), { kind: 'accepted', revision });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(PREDICTION_SUBMISSION_DEADLINE_MS);
  controller.abort();
  assert.equal(requestSignal?.aborted, false);
});

test('browser receipt checksum matches the database normalization including original CAS revision', async () => {
  assert.equal(await predictionPayloadHash(input), predictionAttemptPayloadHash({ ...input, handle: null }));
  assert.equal(await predictionPayloadHash({ ...input, picks: { pole: 'driver_b', winner: 'driver_a' } }), await predictionPayloadHash(input));
  assert.notEqual(await predictionPayloadHash({ ...input, expectedRevision: revision }), await predictionPayloadHash(input));
});
