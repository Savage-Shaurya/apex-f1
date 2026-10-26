import assert from 'node:assert/strict';
import test from 'node:test';
import { workerBudgetMs } from './worker-policy';
import { runLeasedJob, JobBudgetError, type Lease } from './job-control';

test('daily and historical CLI policies have finite bounds and reject indefinite overrides', () => {
  const daily = workerBudgetMs('youtube-sync');
  const history = workerBudgetMs('jolpica-historical');
  assert.ok(daily > 0 && daily <= 15 * 60_000);
  assert.ok(history > daily && history <= 24 * 60 * 60_000);
  for (const value of [Infinity, NaN, 0, -1, 24 * 60 * 60_000 + 1])
    assert.throws(() => workerBudgetMs('jolpica-historical', value), TypeError);
});

test('the resolved CLI policy stops a stalled task and releases its ownership', async () => {
  let releases = 0;
  const lease: Lease = { key: 'bounded-cli', token: 'fixture', expiresAt: new Date(Date.now() + 120_000).toISOString() };
  const store = { claim: async () => lease, renew: async () => lease, release: async () => { releases++; return true; } };
  await assert.rejects(runLeasedJob('bounded-cli', store, async (job) => {
    await new Promise<void>((_resolve, reject) => {
      if (job.signal.aborted) reject(job.signal.reason);
      else job.signal.addEventListener('abort', () => reject(job.signal.reason), { once: true });
    });
  }, { budgetMs: workerBudgetMs('jolpica-historical', 20) }), JobBudgetError);
  assert.equal(releases, 1);
});
