import { randomUUID } from 'node:crypto';
import { createLiveSessionHub, waitForLiveTick, type HubDependencies, type LiveFrame, type LiveEventName, type LiveChannelRead } from './live-session-hub';
import { sanitizeLiveFrame } from './live-frame-schema';
import { createUpstashLiveSharedStore, liveStoreConfig, mayUseProcessLiveHub, LIVE_LEASE_MS, LIVE_REQUEST_GAP_MS, type LiveSharedSnapshot, type LiveSharedStore } from './live-shared-store';
import { createUpstashOpenF1ReadStore, type OpenF1ReadStore } from './openf1-read-store';
import { createLiveSourceSnapshot, liveSourceQuery, liveSourceFreshnessMs, mergeLivePositionSnapshots, type LiveSourceEndpoint, type LiveSourceSnapshot } from './live-source-snapshot';

interface DistributedDependencies extends HubDependencies { store: LiveSharedStore; sourceStore?: OpenF1ReadStore; ownerId?: string }
const AGE_MS = 30_000;
const transportSignature = (frame: LiveFrame) => JSON.stringify({ event: frame.event, data: { ...frame.data, ts: undefined } });

/** Redis owns election, fencing, request pacing and snapshots; processes own viewers. */
export function createDistributedLiveSessionHub(dependencies: DistributedDependencies, policy: { automatic?: boolean } = {}) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? waitForLiveTick;
  const ownerBase = dependencies.ownerId ?? randomUUID();
  const listeners = new Set<(frame: LiveFrame) => void>();
  const cached = new Map<LiveEventName, LiveFrame>();
  const signatures = new Map<LiveEventName, string>();
  let runController: AbortController | null = null;
  let activeRefresh: { promise: Promise<void>; controller: AbortController } | null = null;
  let engine: ReturnType<typeof createLiveSessionHub> | null = null;
  let engineUnsubscribe: (() => void) | null = null;
  let ownerFrames = new Map<LiveEventName, LiveFrame>();
  let fence: number | null = null;
  let lastRevision = 0;
  let lastSnapshot: LiveSharedSnapshot | null = null;
  let upstreamRequests = 0;
  let generation = 0;
  let owner = `${ownerBase}_0`;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const emit = (frame: LiveFrame) => {
    const clean = frame.event === 'heartbeat' ? frame : sanitizeLiveFrame(frame);
    if (!clean) return;
    const signature = transportSignature(clean);
    if (clean.event !== 'heartbeat' && signatures.get(clean.event) === signature) return;
    if (clean.event !== 'heartbeat') { cached.set(clean.event, clean); signatures.set(clean.event, signature); }
    for (const listener of listeners) { try { listener(clean); } catch { /* Failed viewers do not stop ingestion. */ } }
  };
  const display = (snapshot: LiveSharedSnapshot) => {
    if (snapshot.revision < lastRevision || snapshot.writtenAt > now() + 5_000) throw new Error('Shared snapshot unavailable');
    lastRevision = snapshot.revision;
    lastSnapshot = snapshot;
    const delayed = now() - snapshot.writtenAt > LIVE_LEASE_MS;
    // A new snapshot is a complete channel set, so old-session channels cannot survive it.
    const names = new Set(snapshot.frames.map((frame) => frame.event));
    for (const event of cached.keys()) if (!names.has(event)) { cached.delete(event); signatures.delete(event); }
    for (const frame of snapshot.frames) {
      const data = { ...frame.data };
      const timestamp = typeof data.dataTimestamp === 'number' ? data.dataTimestamp : null;
      const oldSample = timestamp === null || now() - timestamp > AGE_MS || timestamp > now() + 5_000;
      if (data.delivery === 'live' && (oldSample || delayed)) {
        data.delivery = timestamp === null ? 'unavailable' : 'stale';
        data.status = data.delivery;
        data.stale = true;
        if (frame.event === 'session_state') data.detail = 'Showing the last verified telemetry; shared updates are delayed.';
      }
      if (delayed && (frame.event === 'weather' || frame.event === 'race_control')) data.stale = true;
      emit({ event: frame.event, data });
    }
  };
  const unavailable = () => {
    lastSnapshot = null;
    const previous = cached.get('session_state');
    emit({ event: 'session_state', data: {
      ...previous?.data, state: previous?.data.state ?? 'no_session', status: 'unavailable', delivery: 'unavailable',
      realtimeAvailable: false, dataTimestamp: previous?.data.dataTimestamp ?? null,
      lastDataAt: previous?.data.lastDataAt ?? null, sourceUpdatedAt: previous?.data.sourceUpdatedAt ?? null,
      detail: 'Shared live updates are unavailable; no current telemetry is verified.',
    } });
    const tower = cached.get('tower');
    if (tower) emit({ event: 'tower', data: { ...tower.data, status: 'stale', delivery: 'stale', stale: true } });
    for (const event of ['weather', 'race_control'] as const) {
      const previous = cached.get(event);
      if (previous) emit({ event, data: { ...previous.data, stale: true } });
    }
  };
  const discardEngine = () => {
    if (engine) upstreamRequests += engine.metrics().upstreamRequests;
    engineUnsubscribe?.(); engineUnsubscribe = null;
    engine?.dispose(); engine = null;
    ownerFrames = new Map();
  };
  const release = (releasedOwner: string, releasedFence: number) => {
    // A fenced release cannot delete a successor's lease. REST has its own 3-second deadline.
    void dependencies.store.release(releasedOwner, releasedFence, new AbortController().signal).catch(() => {});
  };
  const reserve = async (signal: AbortSignal, expectedOwner: string, expectedFence: number) => {
    for (;;) {
      signal.throwIfAborted();
      const result = await dependencies.store.reserve(expectedOwner, expectedFence, signal);
      if (result.owned && result.retryMs === 0 && signal.aborted) {
        // A granted start is still charged to the account. Retire only this
        // owner's dispatch guard if cancellation arrived on its reply; no
        // provider was invoked and no consumed quota is refunded.
        const cleanup = new AbortController();
        const cleanupTimer = setTimeout(() => cleanup.abort(), 3_000);
        try { await dependencies.store.complete?.(expectedOwner, expectedFence, cleanup.signal); }
        finally { clearTimeout(cleanupTimer); }
      }
      signal.throwIfAborted();
      if (!result.owned) throw new Error('Live owner lease lost');
      if (result.retryMs === 0) return;
      // Renew the lease while awaiting a global quota slot, rather than holding stale ownership.
      await wait(Math.min(result.retryMs, 5_000), signal);
    }
  };
  const refresh = (signal: AbortSignal): Promise<void> => {
    if (activeRefresh && !activeRefresh.controller.signal.aborted) return activeRefresh.promise;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const currentGeneration = generation;
    const currentOwner = owner;
    const job = { controller, promise: Promise.resolve() };
    job.promise = (async () => {
      try {
        controller.signal.throwIfAborted();
        const claim = await dependencies.store.claim(currentOwner, controller.signal);
        if (claim.owner && (controller.signal.aborted || currentGeneration !== generation)) {
          // Redis may have granted this lease before a cancellation or a
          // reconnect reached the caller. Its exact returned fence must be
          // retired even though it was never installed as our active engine.
          const cleanup = new AbortController();
          const cleanupTimer = setTimeout(() => cleanup.abort(), 3_000);
          try { await dependencies.store.release(currentOwner, claim.fence, cleanup.signal); }
          finally { clearTimeout(cleanupTimer); }
          return;
        }
        controller.signal.throwIfAborted();
        if (currentGeneration !== generation) return;
        if (!claim.owner) {
          if (fence !== null) { discardEngine(); fence = null; }
          const snapshot = await dependencies.store.read(controller.signal);
          controller.signal.throwIfAborted();
          if (currentGeneration !== generation) return;
          if (snapshot) display(snapshot); else unavailable();
          return;
        }
        if (claim.fence !== fence) { discardEngine(); fence = claim.fence; }
        const expectedFence = claim.fence;
        if (!engine) {
          const rawSnapshots = new Map<LiveSourceEndpoint, LiveSourceSnapshot>();
          let rawSessionKey: number | null = null;
          const assertCurrent = (requestSignal: AbortSignal) => {
            requestSignal.throwIfAborted();
            if (currentGeneration !== generation || createdEngine !== engine || fence !== expectedFence || currentOwner !== owner) throw new Error('Live owner generation lost');
          };
          const publishSource = async (read: LiveChannelRead, requestSignal: AbortSignal) => {
            const sourceStore = dependencies.sourceStore;
            if (!sourceStore || !read.succeeded) return;
            if (!sourceStore.publishLiveSource) throw new Error('Raw source publication unavailable');
            assertCurrent(requestSignal);
            const endpoint: LiveSourceEndpoint = read.channel === 'session' ? 'sessions' : read.channel === 'positions' ? 'position' : read.channel;
            if (read.channel === 'session') {
              const candidate = read.data as { session_key?: unknown } | null;
              const nextKey = candidate && typeof candidate.session_key === 'number' && Number.isSafeInteger(candidate.session_key) && candidate.session_key > 0 ? candidate.session_key : null;
              if (nextKey !== rawSessionKey) rawSnapshots.clear();
              rawSessionKey = nextKey;
            }
            if (endpoint !== 'sessions' && rawSessionKey === null) throw new Error('Raw source session identity unavailable');
            const identity = { endpoint, sessionKey: endpoint === 'sessions' ? 'latest' as const : rawSessionKey! };
            const rows = endpoint === 'sessions' ? read.data === null ? [] : [read.data] : read.data;
            if (!Array.isArray(rows)) throw new Error('Raw source rows unavailable');
            let snapshot = await createLiveSourceSnapshot(identity, rows, {
              acquisitionStartedAt: read.acquisitionStartedAt,
              acquisitionCompletedAt: read.acquisitionCompletedAt,
              coverageLower: read.options.dateGte ?? null,
              coverageUpper: read.options.dateLte ?? null,
            }, now(), requestSignal);
            if (endpoint === 'position') snapshot = await mergeLivePositionSnapshots(rawSnapshots.get(endpoint) ?? null, snapshot, now(), requestSignal);
            assertCurrent(requestSignal);
            // Keep validated sparse-position provenance even if a concurrent
            // SSR refresh currently owns publication. A later overlap read
            // must not discard the initial source records merely because its
            // first durable write lost the shared query claim.
            rawSnapshots.set(endpoint, snapshot);
            const query = liveSourceQuery(endpoint, identity.sessionKey);
            const queryOwner = randomUUID();
            const lock = await sourceStore.claim(query, queryOwner, requestSignal);
            // A concurrently running source refresh owns the same global
            // claim. Its fenced publication wins; viewers never amplify it.
            if (!lock.owner) return;
            try {
              assertCurrent(requestSignal);
              const remaining = liveSourceFreshnessMs(endpoint) - Math.max(0, now() - snapshot.acquisitionStartedAt);
              if (remaining < 1_000) throw new Error('Raw source acquisition expired');
              const saved = await sourceStore.publishLiveSource(query, queryOwner, lock.fence, currentOwner, expectedFence, snapshot, remaining, requestSignal);
              assertCurrent(requestSignal);
              if (!saved) throw new Error('Raw source publication fence or ordering lost');
            } finally {
              // Exact query-fence cleanup is independently bounded by its
              // transport, even if the live caller was cancelled.
              await sourceStore.release(query, queryOwner, lock.fence, new AbortController().signal);
            }
          };
          const createdEngine = createLiveSessionHub({ ...dependencies, beforeRequest: (requestSignal) => reserve(requestSignal, currentOwner, expectedFence),
            afterRequest: async () => { await dependencies.store.complete?.(currentOwner, expectedFence, new AbortController().signal); },
            onChannelSettled: async (read, requestSignal) => {
              assertCurrent(requestSignal);
              await publishSource(read, requestSignal);
              assertCurrent(requestSignal);
              await dependencies.onChannelSettled?.(read, requestSignal);
              assertCurrent(requestSignal);
              // Publish the complete known channel set after each settled
              // source read. A slow later channel cannot hide an already
              // verified timing update from followers. Original source ages
              // and missing-channel state remain in the sanitized frames.
              const snapshot = await dependencies.store.publish(currentOwner, expectedFence, [...ownerFrames.values()], requestSignal);
              assertCurrent(requestSignal);
              if (!snapshot) throw new Error('Live publication fence lost');
              display(snapshot);
            },
          }, { automatic: false, requestGapMs: LIVE_REQUEST_GAP_MS });
          engine = createdEngine;
          engineUnsubscribe = engine.subscribe((frame) => {
            if (frame.event === 'session_state' && ownerFrames.get('session_state')?.data.session_key !== frame.data.session_key) ownerFrames.clear();
            if (frame.event !== 'heartbeat') ownerFrames.set(frame.event, frame);
          });
        }
        const currentEngine = engine;
        await currentEngine.refresh(controller.signal);
        controller.signal.throwIfAborted();
        if (currentGeneration !== generation || currentEngine !== engine || fence !== expectedFence) return;
        const snapshot = await dependencies.store.publish(currentOwner, expectedFence, [...ownerFrames.values()], controller.signal);
        controller.signal.throwIfAborted();
        if (currentGeneration !== generation) return;
        if (!snapshot) { discardEngine(); fence = null; unavailable(); return; }
        display(snapshot);
      } catch {
        if (currentGeneration !== generation || controller.signal.aborted) return;
        const previousFence = fence;
        discardEngine(); fence = null;
        if (previousFence !== null) release(currentOwner, previousFence);
        unavailable();
      }
    })().finally(() => {
      signal.removeEventListener('abort', abort);
      if (activeRefresh === job) activeRefresh = null;
    });
    activeRefresh = job;
    return job.promise;
  };
  const run = async (controller: AbortController, currentGeneration: number) => {
    while (!controller.signal.aborted && listeners.size && currentGeneration === generation) {
      await refresh(controller.signal);
      if (controller.signal.aborted || currentGeneration !== generation) return;
      await wait(1_000, controller.signal);
    }
  };
  const stop = () => {
    const previousOwner = owner;
    generation += 1;
    owner = `${ownerBase}_${generation}`;
    runController?.abort(); runController = null;
    activeRefresh?.controller.abort();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    const previousFence = fence;
    fence = null;
    discardEngine();
    if (previousFence !== null) release(previousOwner, previousFence);
  };
  return {
    scope: 'shared-snapshot' as const,
    subscribe(listener: (frame: LiveFrame) => void) {
      // Re-age cached snapshots before replay; reconnecting does not make samples fresh.
      if (lastSnapshot) { try { display(lastSnapshot); } catch { unavailable(); } }
      listeners.add(listener);
      for (const frame of cached.values()) { try { listener(frame); } catch { /* Independent viewer. */ } }
      if (!runController && policy.automatic !== false) {
        runController = new AbortController();
        const currentController = runController;
        const currentGeneration = generation;
        heartbeat = setInterval(() => emit({ event: 'heartbeat', data: { ts: now() } }), 30_000);
        void run(currentController, currentGeneration).catch(() => {
          if (!currentController.signal.aborted && currentGeneration === generation) unavailable();
        });
      }
      let removed = false;
      return () => { if (removed) return; removed = true; listeners.delete(listener); if (!listeners.size) stop(); };
    },
    refresh,
    dispose() { listeners.clear(); stop(); },
    metrics() { return { subscribers: listeners.size, upstreamRequests: upstreamRequests + (engine?.metrics().upstreamRequests ?? 0), retainedFrames: cached.size, running: runController !== null, owner: fence !== null, fence }; },
  };
}

export function createConfiguredLiveSessionHub(dependencies: HubDependencies) {
  const config = liveStoreConfig();
  if (config) return createDistributedLiveSessionHub({ ...dependencies, store: createUpstashLiveSharedStore(config), sourceStore: createUpstashOpenF1ReadStore(config) });
  if (mayUseProcessLiveHub()) return { ...createLiveSessionHub(dependencies), scope: 'process-snapshot' as const };
  return null;
}
