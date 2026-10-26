import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError, withProviderDeadline } from '../../../packages/api-client/src/transport';
import { ChampionshipReadGate, readChampionshipArchive } from './championship-archive';

test('completed archives cover every eligible year, preserve descending order and cap active reads at three', async () => {
  for (const [kind, from] of [['driver', 1950], ['constructor', 1958]] as const) {
    let active = 0; let maximum = 0; const calls: number[] = [];
    const through = new Date().getUTCFullYear() - 1;
    const result = await readChampionshipArchive(kind, through, async year => {
      active++; maximum = Math.max(maximum, active); calls.push(year);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return { id: `winner_${year}` };
    });
    assert.equal(result.state, 'complete'); assert.equal(result.records.length, through - from + 1);
    assert.deepEqual(result.records.map(record => record.year), [...calls].sort((a, b) => b - a));
    assert.equal(result.records.at(-1)?.year, from); assert.equal(maximum, 3); assert.deepEqual(result.missing, []);
  }
});

test('unpublished seasons and source failures produce explicit partial coverage rather than complete title totals', async () => {
  const result = await readChampionshipArchive('driver', 1953, async year => {
    if (year === 1952) return null;
    if (year === 1951) throw new ProviderError('jolpica', 'http', 429);
    return { id: `winner_${year}` };
  });
  assert.equal(result.state, 'partial'); assert.deepEqual(result.records.map(row => row.year), [1953, 1950]);
  assert.deepEqual(result.missing, [1952, 1951]); assert.deepEqual(result.unavailable, [1951]);
  assert.equal((await readChampionshipArchive('constructor', 1960, async () => null)).state, 'empty');
  assert.equal((await readChampionshipArchive('constructor', 1960, async () => { throw new ProviderError('jolpica', 'http', 503); })).state, 'unavailable');
});

test('whole archive deadline bounds an abort-ignoring source and starts no later reads', async () => {
  let calls = 0;
  const startedAt = performance.now();
  const result = await readChampionshipArchive('driver', 2025, async () => { calls++; return new Promise<never>(() => {}); }, { budgetMs: 25 });
  assert.equal(result.state, 'unavailable'); assert.equal(calls, 3); assert.equal(result.records.length, 0);
  assert.ok(performance.now() - startedAt < 500);
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls, 3);
});

test('invalid/future years reject without reads and pre-aborted archive starts nothing', async () => {
  let calls = 0; const reader = async () => { calls++; return {}; };
  await assert.rejects(readChampionshipArchive('driver', new Date().getUTCFullYear() + 1, reader), error => error instanceof ProviderError && error.code === 'invalid-input');
  await assert.rejects(readChampionshipArchive('constructor', 1957, reader), error => error instanceof ProviderError && error.code === 'invalid-input');
  const controller = new AbortController(); controller.abort();
  const result = await readChampionshipArchive('driver', 2025, reader, { signal: controller.signal });
  assert.equal(result.state, 'unavailable'); assert.equal(calls, 0);
});

test('shared cache-refresh gate caps active cold/background work and releases abort-ignoring operations', async () => {
  const gate = new ChampionshipReadGate(); let active = 0; let maximum = 0;
  await Promise.all(Array.from({ length: 12 }, () => withProviderDeadline('jolpica', signal => gate.run(async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--; return true;
  }, signal, Date.now() + 1000), { timeoutMs: 1000 })));
  assert.equal(maximum, 3);
  await assert.rejects(withProviderDeadline('jolpica', signal => gate.run(() => new Promise<never>(() => {}), signal, Date.now() + 1000), { timeoutMs: 10 }));
  assert.equal(await withProviderDeadline('jolpica', signal => gate.run(async () => true, signal, Date.now() + 1000), { timeoutMs: 1000 }), true);
});

test('expired queued cache refresh cannot begin a provider read', async () => {
  const gate = new ChampionshipReadGate(); const releases: Array<() => void> = [];
  const hold = Array.from({ length: 3 }, () => withProviderDeadline('jolpica', signal => gate.run(() => new Promise<void>(resolve => releases.push(resolve)), signal, Date.now() + 1000), { timeoutMs: 1000 }));
  await new Promise(resolve => setTimeout(resolve, 1)); let calls = 0;
  const queued = withProviderDeadline('jolpica', signal => gate.run(async () => { calls++; return true; }, signal, Date.now() + 5), { timeoutMs: 1000 });
  const rejected = assert.rejects(queued, error => error instanceof ProviderError && error.code === 'timeout');
  await new Promise(resolve => setTimeout(resolve, 10)); releases.forEach(release => release());
  await Promise.all(hold); await rejected; assert.equal(calls, 0);
});
