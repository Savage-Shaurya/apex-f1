import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from './client';
import { beginSourceObservation, SourceObservationSupersededError, type SourceObservation } from './source-observation';
import { getYoutubeVideoIdsForVerification, persistVideoDetailsSnapshot, persistVideos, type VideoDetailsSnapshot } from './videos';

const A = 'AAAAAAAAAAA';
const B = 'BBBBBBBBBBB';
const C = 'CCCCCCCCCCC';
interface StoredVideo { id: string; slug: string; asset: string; title: string; provider: string; availability: string; raceId: string | null; sessionId: string | null; durationSeconds?: number | null }
interface SnapshotState { generation: number; observationId: string; details: Record<string, unknown>; expires: number }

/** Only intercept serialized Drizzle operations; no network or native DB here. */
async function fixture(run: (state: {
  videos: Map<string, StoredVideo>; snapshots: Map<string, SnapshotState>; now: number; failCheckpoint: boolean; expireAfterVideoWrite: boolean;
  statements: { query: string; parameters: unknown[] }[];
}) => Promise<void>) {
  const previousUrl = process.env.DATABASE_URL;
  const previousWorkerUrl = process.env.DATABASE_WORKER_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  delete process.env.DATABASE_WORKER_URL;
  delete process.env.DATABASE_SSL_CA_PATH;
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const originalBegin = client.begin;
  const initial = (asset: string, availability = 'public'): StoredVideo => ({ id: `fixture-${asset}`, slug: `editorial-${asset}`, asset, title: `Existing ${asset}`, provider: 'youtube', availability, raceId: 'preserved-race', sessionId: 'preserved-session', durationSeconds: 90 });
  const state = {
    videos: new Map([[A, initial(A)], [B, initial(B)], [C, initial(C, 'unavailable')]]),
    snapshots: new Map<string, SnapshotState>(), now: 100_000, failCheckpoint: false, expireAfterVideoWrite: false,
    statements: [] as { query: string; parameters: unknown[] }[],
  };
  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    // Transaction-local timeouts (bounded-transaction.ts) open every transaction; no fixture state.
    if (/^select set_config\('statement_timeout'/.test(query)) { const none = Promise.resolve([]); return Object.assign(none, { values: () => none }); }
    state.statements.push({ query, parameters });
    let rows: Record<string, unknown>[] = [];
    if (/^insert into source_snapshot/.test(query)) {
      const [source, scope, observationId, ttl] = parameters as [string, string, string, number];
      const key = `${source}:${scope}`;
      const old = state.snapshots.get(key);
      const next = { generation: (old?.generation ?? 0) + 1, observationId, details: old?.details ?? {}, expires: state.now + ttl * 1000 };
      state.snapshots.set(key, next);
      rows = [{ generation: String(next.generation) }];
    } else if (/^select generation from source_snapshot/.test(query)) {
      assert.match(query, /expires_at > clock_timestamp\(\) for update/);
      const [source, scope, generation, id] = parameters as [string, string, string, string];
      const current = state.snapshots.get(`${source}:${scope}`);
      if (current?.generation === Number(generation) && current.observationId === id && current.expires > state.now) rows = [{ generation }];
    } else if (/^update source_snapshot/.test(query)) {
      if (state.failCheckpoint) throw new Error('Synthetic checkpoint write failure.');
      assert.match(query, /generation = \$\d+::bigint and observation_id = \$\d+::uuid/);
      const [_appliedId, hash, details, source, scope, generation, id] = parameters as [string, string, string, string, string, string, string];
      assert.match(hash, /^[0-9a-f]{64}$/);
      const current = state.snapshots.get(`${source}:${scope}`);
      if (current?.generation === Number(generation) && current.observationId === id) current.details = { ...current.details, ...JSON.parse(details) };
    } else if (/^select details->>'verificationAfterVideoId'/.test(query)) {
      rows = [{ afterVideoId: state.snapshots.get('youtube:details')?.details.verificationAfterVideoId ?? null }];
    } else if (/^insert into "video"/.test(query)) {
      const match = query.match(/^insert into "video" \(([^)]+)\) values ([\s\S]+?) on conflict/)!;
      const columns = match[1]!.replaceAll('"', '').split(', ');
      const sets = query.split('do update set')[1]!;
      assert.doesNotMatch(sets, /"(?:slug|race_id|session_id|description_md)"\s*=/);
      for (const tuple of match[2]!.match(/\([^()]*\)/g) ?? []) {
        const values = tuple.slice(1, -1).split(', ');
        const record = Object.fromEntries(columns.map((column, index) => {
          const parameter = values[index]!.match(/^\$(\d+)$/);
          return [column, parameter ? parameters[Number(parameter[1]) - 1] : null];
        }));
        const asset = record.provider_asset_id as string;
        const old = state.videos.get(asset);
        if (old) {
          old.title = record.title as string;
          old.durationSeconds = (record.duration_seconds as number | null) ?? old.durationSeconds;
          if (/"availability"\s*=/.test(sets)) old.availability = record.availability as string;
        } else state.videos.set(asset, { id: `fixture-${asset}`, asset, slug: record.slug as string, title: record.title as string, provider: record.provider as string, availability: record.availability as string, raceId: null, sessionId: null });
      }
      if (state.expireAfterVideoWrite) { state.now += 300_000; state.expireAfterVideoWrite = false; }
    } else if (/^update "video"/.test(query)) {
      assert.match(query, /"video"\."provider" = \$\d+ and "video"\."provider_asset_id" in/);
      const [availability, provider, ...ids] = parameters as [string, string, ...string[]];
      assert.equal(availability, 'unavailable');
      assert.equal(provider, 'youtube');
      for (const id of ids) {
        const current = state.videos.get(id);
        if (current?.provider === provider) { current.availability = availability; rows.push({ id: current.id }); }
      }
    } else if (/^select "provider_asset_id" from "video"/.test(query)) {
      const cursorMatch = query.match(/"provider_asset_id" > \$(\d+)/);
      const cursor = cursorMatch ? parameters[Number(cursorMatch[1]) - 1] as string : null;
      const excludeMatch = query.match(/"provider_asset_id" not in \(([^)]+)\)/);
      const excluded = excludeMatch ? [...excludeMatch[1]!.matchAll(/\$(\d+)/g)].map((match) => parameters[Number(match[1]) - 1]) : [];
      const limit = parameters[parameters.length - 1] as number;
      rows = [...state.videos.values()].filter((row) => row.provider === 'youtube' && (!cursor || row.asset > cursor) && !excluded.includes(row.asset)).sort((a, b) => a.asset < b.asset ? -1 : 1).slice(0, limit).map((row) => ({ videoId: row.asset }));
    } else { throw new Error(`Video fixture refuses an unrelated statement: ${query.slice(0, 60)}`); }
    const response = Promise.resolve(rows);
    return Object.assign(response, { values: () => response.then((values) => values.map((row) => Object.values(row))) });
  });
  Reflect.set(client, 'begin', async (callback: (connection: typeof client) => Promise<unknown>) => {
    const beforeVideos = structuredClone(state.videos);
    const beforeSnapshots = structuredClone(state.snapshots);
    try { return await callback(client); }
    catch (error) { state.videos = beforeVideos; state.snapshots = beforeSnapshots; throw error; }
  });
  try { await run(state); }
  finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    Reflect.set(client, 'begin', originalBegin);
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousWorkerUrl === undefined) delete process.env.DATABASE_WORKER_URL; else process.env.DATABASE_WORKER_URL = previousWorkerUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
}
const observe = () => beginSourceObservation({ source: 'youtube', scope: 'details' });
const input = (observation: SourceObservation): VideoDetailsSnapshot => ({ observation, requestedVideoIds: [A, B], publicVideos: [{ videoId: A, title: 'Verified A' }], unavailableVideoIds: [B] });

test('successful complete details snapshot hides only targeted IDs and preserves older videos and editorial links', async () => fixture(async (state) => {
  const observation = await observe();
  assert.deepEqual(await persistVideoDetailsSnapshot({ ...input(observation), verificationCursor: B }), { persisted: 1, unavailable: 1 });
  assert.equal(state.videos.get(A)?.title, 'Verified A');
  assert.equal(state.videos.get(A)?.slug, `editorial-${A}`);
  assert.equal(state.videos.get(A)?.raceId, 'preserved-race');
  assert.equal(state.videos.get(A)?.sessionId, 'preserved-session');
  assert.equal(state.videos.get(A)?.durationSeconds, 90);
  assert.equal(state.videos.get(B)?.availability, 'unavailable');
  assert.equal(state.videos.has(B), true, 'Unavailable records are retained.');
  assert.equal(state.videos.get(C)?.availability, 'unavailable', 'Unrequested records are untouched.');
  assert.equal(state.snapshots.get('youtube:details')?.details.verificationAfterVideoId, B);
  assert.equal(state.statements.some(({ query }) => /^delete/.test(query)), false);
}));

test('newer public verification restores a video and delayed older observations cannot hide it', async () => fixture(async (state) => {
  const older = await observe();
  const current = await observe();
  assert.deepEqual(await persistVideoDetailsSnapshot({ observation: current, requestedVideoIds: [C], publicVideos: [{ videoId: C, title: 'Restored C' }], unavailableVideoIds: [] }), { persisted: 1, unavailable: 0 });
  await assert.rejects(persistVideoDetailsSnapshot({ observation: older, requestedVideoIds: [C], publicVideos: [], unavailableVideoIds: [C] }), SourceObservationSupersededError);
  assert.equal(state.videos.get(C)?.availability, 'public');
  assert.equal(state.videos.get(C)?.title, 'Restored C');
}));

test('partial, duplicate, unrequested and overlapping details IDs never write video data', async () => fixture(async (state) => {
  const observation = await observe();
  const invalid: VideoDetailsSnapshot[] = [
    { ...input(observation), unavailableVideoIds: [] },
    { ...input(observation), requestedVideoIds: [A, A] },
    { ...input(observation), publicVideos: [{ videoId: C, title: 'Wrong identity' }] },
    { ...input(observation), unavailableVideoIds: [A] },
    { ...input(observation), publicVideos: [{ videoId: A, title: 'A' }, { videoId: A, title: 'Duplicate' }] },
    { ...input(observation), observation: { ...observation, scope: 'playlist' } },
    { ...input(observation), verificationCursor: 'bad' },
    { ...input(observation), verificationCursor: C },
  ];
  for (const candidate of invalid) await assert.rejects(persistVideoDetailsSnapshot(candidate), /(?:snapshot|identit|scope|cursor)/i);
  assert.equal(state.statements.some(({ query }) => /^(?:insert into "video"|update "video")/.test(query)), false);
  assert.equal(state.videos.get(B)?.availability, 'public');
}));

test('checkpoint failure and source expiry roll back video mutations and cursor together', async () => fixture(async (state) => {
  const observation = await observe();
  state.failCheckpoint = true;
  await assert.rejects(persistVideoDetailsSnapshot({ ...input(observation), verificationCursor: B }), (error: unknown) => error instanceof Error && error.cause instanceof Error && /checkpoint/.test(error.cause.message));
  assert.equal(state.videos.get(A)?.title, `Existing ${A}`);
  assert.equal(state.videos.get(B)?.availability, 'public');
  assert.equal(state.snapshots.get('youtube:details')?.details.verificationAfterVideoId, undefined);
  state.failCheckpoint = false;
  state.expireAfterVideoWrite = true;
  await assert.rejects(persistVideoDetailsSnapshot(input(observation)), SourceObservationSupersededError);
  assert.equal(state.videos.get(B)?.availability, 'public');
}));

test('durable verification cursor rotates older stored identities and can revisit unavailable videos', async () => fixture(async (state) => {
  const observation = await observe();
  assert.deepEqual(await getYoutubeVideoIdsForVerification({ excludeVideoIds: [A], limit: 1 }), { videoIds: [B], nextAfterVideoId: B });
  await persistVideoDetailsSnapshot({ ...input(observation), verificationCursor: B });
  assert.deepEqual(await getYoutubeVideoIdsForVerification({ excludeVideoIds: [A], limit: 1 }), { videoIds: [C], nextAfterVideoId: C });
  assert.deepEqual(await getYoutubeVideoIdsForVerification({ afterVideoId: C, excludeVideoIds: [A], limit: 2 }), { videoIds: [B, C], nextAfterVideoId: C });
  await assert.rejects(getYoutubeVideoIdsForVerification({ limit: 101 }), /limit/);
  state.snapshots.get('youtube:details')!.details.verificationAfterVideoId = 'malformed';
  await assert.rejects(getYoutubeVideoIdsForVerification(), /cursor/);
}));

test('upsert-only legacy writes cannot restore a verified unavailable video', async () => fixture(async (state) => {
  assert.equal(await persistVideos([{ videoId: C, title: 'Legacy update' }]), 1);
  assert.equal(state.videos.get(C)?.availability, 'unavailable');
  assert.equal(state.videos.get(C)?.slug, `editorial-${C}`);
}));
