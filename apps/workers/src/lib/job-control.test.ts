import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JobBudgetError, JobLeaseLostError, runLeasedJob, type Lease, type LeaseStore } from './job-control';

function fixture() {
  let current: Lease | null = null;
  let claims = 0, renewals = 0, releases = 0;
  let lose = false;
  const store: LeaseStore = {
    async claim({ key, ttlSeconds }) {
      claims++;
      if (current) return null;
      return current = { key, token: 'disposable-lease', expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() };
    },
    async renew(lease, ttlSeconds) {
      renewals++;
      if (lose || current?.token !== lease.token) return null;
      return current = { ...lease, expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString() };
    },
    async release(lease) {
      releases++;
      if (current?.token !== lease.token) return false;
      current = null; return true;
    },
  };
  return { store, lose: () => { lose = true; }, metrics: () => ({ claims, renewals, releases, current }) };
}

test('concurrent job invocations run one task and report the other as busy', async () => {
  const setup = fixture();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const first = runLeasedJob('youtube-sync', setup.store, async () => { await gate; return 4; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = await runLeasedJob('youtube-sync', setup.store, async () => { assert.fail('duplicate task'); });
  assert.deepEqual(second, { status: 'busy' });
  finish();
  assert.deepEqual(await first, { status: 'completed', value: 4 });
  assert.equal(setup.metrics().releases, 1);
});

test('job failure releases ownership and permits an explicit rerun', async () => {
  const setup = fixture();
  await assert.rejects(runLeasedJob('job', setup.store, async () => { throw new Error('write failed'); }), /write failed/);
  assert.equal(setup.metrics().current, null);
  assert.deepEqual(await runLeasedJob('job', setup.store, async () => 'rerun'), { status: 'completed', value: 'rerun' });
});

test('lost renewal aborts upstream work and never reports completed', async () => {
  const setup = fixture();
  setup.lose();
  await assert.rejects(runLeasedJob('job', setup.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return 'late success';
  }, { ttlSeconds: 1, renewEveryMs: 5 }), JobLeaseLostError);
  assert.equal(setup.metrics().renewals, 1);
  assert.equal(setup.metrics().releases, 1);
});

test('deadline waits for cooperative task cleanup before releasing the lease', async () => {
  const setup = fixture();
  let cleaned = false;
  await assert.rejects(runLeasedJob('job', setup.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.notEqual(setup.metrics().current, null);
    cleaned = true;
  }, { budgetMs: 5 }), JobBudgetError);
  assert.equal(cleaned, true);
  assert.equal(setup.metrics().current, null);
});

test('external cancellation is propagated and removes its listener after cleanup', async () => {
  const setup = fixture();
  const controller = new AbortController();
  const pending = runLeasedJob('job', setup.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  }, { signal: controller.signal });
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new Error('shutdown'));
  await assert.rejects(pending, /shutdown/);
  assert.equal(setup.metrics().current, null);
});

test('successful cleanup cancels renewal work rather than keeping the process alive', async () => {
  const setup = fixture();
  await runLeasedJob('job', setup.store, async () => 1, { renewEveryMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(setup.metrics().renewals, 0);
});

test('slow lease acquisition consumes the absolute budget instead of starting a new task window', async () => {
  const setup = fixture();
  const originalClaim = setup.store.claim;
  setup.store.claim = async (input) => { await new Promise((resolve) => setTimeout(resolve, 10)); return originalClaim(input); };
  await assert.rejects(runLeasedJob('job', setup.store, async () => assert.fail('expired task must not run'), { budgetMs: 5 }), JobBudgetError);
  assert.equal(setup.metrics().releases, 1);
});

test('a failed release keeps the finished result and flags the cleanup failure', async () => {
  const setup = fixture();
  setup.store.release = async () => false;
  assert.deepEqual(await runLeasedJob('job', setup.store, async () => 'broadcast sent'), { status: 'completed', value: 'broadcast sent', cleanup: 'release-failed' });
});

test('a failed or throwing release never replaces the task\'s real error', async () => {
  const setup = fixture();
  setup.store.release = async () => { throw new Error('release storage down'); };
  await assert.rejects(runLeasedJob('job', setup.store, async () => { throw new Error('real provider failure'); }), /real provider failure/);
});

test('a task that finishes before its budget ends is a completion even if the budget lapses during cleanup', async () => {
  const setup = fixture();
  const originalRelease = setup.store.release;
  setup.store.release = async (lease) => { await new Promise((resolve) => setTimeout(resolve, 20)); return originalRelease(lease); };
  assert.deepEqual(await runLeasedJob('job', setup.store, async () => 'done', { budgetMs: 10 }), { status: 'completed', value: 'done' });
});

test('a task that opted in may return an honest partial report at its budget; a lost lease never can', async () => {
  const setup = fixture();
  const partial = await runLeasedJob('job', setup.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { committed: 3, deferred: 2 };
  }, { budgetMs: 5, acceptPartialOnBudget: (value) => value.deferred > 0 });
  assert.deepEqual(partial, { status: 'completed', value: { committed: 3, deferred: 2 }, budget: 'exhausted' });
  // Without the opt-in the same task is a budget failure, as before.
  await assert.rejects(runLeasedJob('job', setup.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { committed: 3, deferred: 2 };
  }, { budgetMs: 5 }), JobBudgetError);
  const lost = fixture();
  lost.lose();
  await assert.rejects(runLeasedJob('job', lost.store, async ({ signal }) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { committed: 0, deferred: 1 };
  }, { ttlSeconds: 1, renewEveryMs: 5, acceptPartialOnBudget: () => true }), JobLeaseLostError);
});
