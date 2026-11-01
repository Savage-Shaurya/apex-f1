import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';

// Next creates its request stores from the global AsyncLocalStorage (set by its own server
// runtime); install it before loading Next's modules, as `next build` and `next start` do.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;
const { workUnitAsyncStorage } = await import('next/dist/server/app-render/work-unit-async-storage.external');
const { outageConnection } = await import('./outage-connection');

/** The store Next uses while `next build` prerenders an ISR page (no cacheComponents). */
function prerenderStore(revalidate: number) {
  return { type: 'prerender-legacy', phase: 'render', revalidate, expire: Infinity, stale: Infinity, tags: [], implicitTags: { tags: [], expirationsByCacheKind: new Map() }, rootParams: {} };
}

test('F-03: a provider outage while `next build` prerenders keeps the route ISR with a short revalidate', async () => {
  const phase = process.env.NEXT_PHASE;
  process.env.NEXT_PHASE = 'phase-production-build';
  try {
    const store = prerenderStore(300);
    // Before: connection() here made the route dynamic (`ƒ`) for the whole deployment.
    await workUnitAsyncStorage.run(store as never, () => outageConnection());
    assert.equal(store.revalidate, 60, 'the honest state is served for one minute, then ISR regenerates');
    const shorter = prerenderStore(30);
    await workUnitAsyncStorage.run(shorter as never, () => outageConnection());
    assert.equal(shorter.revalidate, 30, 'never lengthens an already shorter window');
  } finally {
    if (phase === undefined) delete process.env.NEXT_PHASE; else process.env.NEXT_PHASE = phase;
  }
});

test('F-03 + DRV-2/RES-3/TEAMS-10: a runtime ISR render that met an outage is cached for one minute, never the full window', async () => {
  const phase = process.env.NEXT_PHASE;
  delete process.env.NEXT_PHASE;
  try {
    const store = prerenderStore(300);
    // No dynamic bailout (connection() would throw DYNAMIC_SERVER_USAGE in an ISR render)...
    await workUnitAsyncStorage.run(store as never, () => outageConnection());
    // ...but before this fix the degraded render ("Career data unavailable", no chart) was kept for 300 s.
    assert.equal(store.revalidate, 60, 'a degraded ISR copy heals within a minute');
    const day = prerenderStore(86_400);
    await workUnitAsyncStorage.run(day as never, () => outageConnection());
    assert.equal(day.revalidate, 60);
    const shorter = prerenderStore(30);
    await workUnitAsyncStorage.run(shorter as never, () => outageConnection());
    assert.equal(shorter.revalidate, 30, 'never lengthens an already shorter window');
  } finally {
    if (phase !== undefined) process.env.NEXT_PHASE = phase;
  }
});
