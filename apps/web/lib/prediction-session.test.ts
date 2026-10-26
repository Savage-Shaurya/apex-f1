import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  browserIdentityLock, browserPredictionAttemptStore, PREDICTION_ATTEMPT_STORAGE,
  PREDICTION_IDENTITY_LOCK, snapshotPredictionInput, type PredictionAttempt,
} from './prediction-session';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const attempt: PredictionAttempt = {
  id: '51f336c4-dd6c-412d-8b4e-d89be5cfe55b', identity: '0ee712a1-d29a-4b76-bf24-323bb3f2521b',
  input: { season: 2026, round: 2, raceSlug: 'fixture-race', picks: { winner: 'driver_a' }, expectedRevision: null },
};

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
});

function storageFixture() {
  const values = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  Object.defineProperty(globalThis, 'window', { value: { sessionStorage }, configurable: true });
  return values;
}

test('production attempt storage persists captured payloads across independent store handles without storing signed cookies', () => {
  const values = storageFixture();
  browserPredictionAttemptStore().write([attempt]);
  assert.deepEqual(browserPredictionAttemptStore().read(), [attempt]);
  assert.doesNotMatch(values.get(PREDICTION_ATTEMPT_STORAGE)!, /v1\.|apex_pid/);
});

test('corrupted attempt storage fails closed rather than replacing an unknown earlier replay key', () => {
  const values = storageFixture();
  for (const value of ['broken JSON', JSON.stringify({ attempts: [] }), JSON.stringify([{ ...attempt, identity: 'unsigned' }])]) {
    values.set(PREDICTION_ATTEMPT_STORAGE, value);
    assert.throws(() => browserPredictionAttemptStore().read());
    assert.equal(values.get(PREDICTION_ATTEMPT_STORAGE), value);
  }
});

test('attempt storage bounds unresolved attempts without silently evicting a receipt key', () => {
  const values = storageFixture();
  const store = browserPredictionAttemptStore();
  store.write([attempt]);
  const before = values.get(PREDICTION_ATTEMPT_STORAGE);
  assert.throws(() => store.write(Array.from({ length: 51 }, () => attempt)));
  assert.equal(values.get(PREDICTION_ATTEMPT_STORAGE), before);
});

test('storage that ignores persistence is detected before upload', () => {
  Object.defineProperty(globalThis, 'window', {
    value: { sessionStorage: { getItem: () => null, setItem: () => {} } }, configurable: true,
  });
  assert.throws(() => browserPredictionAttemptStore().write([attempt]), /not retained/);
});

test('native browser identity lock uses one exclusive origin-scoped name and the operation cancellation signal', async () => {
  storageFixture();
  const controller = new AbortController();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async (name: string, options: { mode: string; signal: AbortSignal }, task: () => Promise<string>) => {
      assert.equal(name, PREDICTION_IDENTITY_LOCK);
      assert.equal(options.mode, 'exclusive');
      assert.equal(options.signal, controller.signal);
      return task();
    },
  } } });
  assert.equal(await browserIdentityLock()!(controller.signal, async () => 'confirmed'), 'confirmed');
});

test('captured choices are independent from caller edits and normalize empty selections while preserving exact revision', () => {
  const input = { ...attempt.input, picks: { winner: 'driver_a', pole: '' }, expectedRevision: '2026-10-03 01:02:03.123456+00' };
  const snapshot = snapshotPredictionInput(input);
  input.picks.winner = 'driver_b';
  assert.deepEqual(snapshot.picks, { winner: 'driver_a' });
  assert.equal(snapshot.expectedRevision, '2026-10-03 01:02:03.123456+00');
});
