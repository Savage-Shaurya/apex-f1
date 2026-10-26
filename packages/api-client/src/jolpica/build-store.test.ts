import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDiskBuildStore } from './build-store';
import { JolpicaRequestControl } from './request-control';

test('F-01: build workers on one disk store fetch each URL once; others wait for the stored copy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apex-build-store-test-'));
  try {
    let physical = 0;
    const transport = async () => { physical++; await new Promise((resolve) => setTimeout(resolve, 150)); return { MRData: { total: '23' } }; };
    // Separate store and controller instances stand in for separate worker processes.
    const workers = Array.from({ length: 5 }, () => new JolpicaRequestControl({ buildPhase: () => true, buildStore: createDiskBuildStore(directory) }));
    const key = 'https://api.jolpi.ca/ergast/f1/current/driverStandings.json?limit=100&offset=0';
    const values = await Promise.all(workers.map((worker) => worker.readThrough(key, 300, { timeoutMs: 20_000 }, transport)));
    assert.equal(physical, 1);
    assert.ok(values.every((value) => JSON.stringify(value) === '{"MRData":{"total":"23"}}'));
    // A later worker reads the stored copy without any request.
    const late = new JolpicaRequestControl({ buildPhase: () => true, buildStore: createDiskBuildStore(directory) });
    assert.deepEqual(await late.readThrough(key, 300, { timeoutMs: 20_000 }, async () => { physical++; return null; }), { MRData: { total: '23' } });
    assert.equal(physical, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('F-01: a failed or abandoned claim never blocks other workers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apex-build-store-test-'));
  try {
    const store = createDiskBuildStore(directory);
    const key = 'https://api.jolpi.ca/ergast/f1/2026.json?limit=100&offset=0';
    assert.equal(await store.claimOrWait(key, Date.now() + 1000), null, 'first caller holds the claim');
    await store.release(key);
    assert.equal(await store.claimOrWait(key, Date.now() + 1000), null, 'released claim can be taken again');
    // A claim left behind by a crashed worker is taken over once it is stale.
    const other = 'https://api.jolpi.ca/ergast/f1/2025.json?limit=100&offset=0';
    const claim = join(directory, `${createHash('sha256').update(other).digest('hex')}.claim`);
    await writeFile(claim, '');
    const old = new Date(Date.now() - 10 * 60_000);
    await utimes(claim, old, old);
    assert.equal(await store.claimOrWait(other, Date.now() + 1000), null);
    // Waiting on a live claim ends at the deadline instead of hanging the build.
    const started = Date.now();
    assert.equal(await createDiskBuildStore(directory).claimOrWait(other, Date.now() + 500), null);
    assert.ok(Date.now() - started < 2_000);
    // Runtime (not the build) never touches the store.
    let physical = 0;
    const runtime = new JolpicaRequestControl({ buildPhase: () => false, buildStore: store });
    await runtime.readThrough(key, 300, { timeoutMs: 5_000 }, async () => { physical++; return 1; });
    assert.equal(physical, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
