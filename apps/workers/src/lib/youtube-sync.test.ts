import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { YTVideoDetail } from '@apex/api-client/youtube';
import { syncRecentYouTubeUploads, type YouTubeSyncDependencies } from './youtube-sync';

const publicVideo = (videoId = 'abcdefghijk'): YTVideoDetail => ({ videoId, title: 'Verified fixture', description: '', channelId: 'curated', channelTitle: 'Curated', publishedAt: '2026-01-01T12:00:00Z', thumbnailUrl: '', durationSeconds: 10, viewCount: null, likeCount: null, commentCount: null, tags: [], categoryId: '', embeddable: true, privacyStatus: 'public', regionBlocked: false });
function fixture() {
  const calls: string[] = [];
  const deps: YouTubeSyncDependencies = {
    channels: [{ channelId: 'curated', name: 'Curated' }],
    begin: async () => { calls.push('begin'); },
    channelStats: async (_ids, opts) => { calls.push('channels'); assert.equal(opts.revalidate, 0); return [{ channelId: 'curated', title: 'Curated', description: '', thumbnailUrl: '', subscriberCount: null, videoCount: null, viewCount: null, uploadsPlaylistId: 'uploads' }]; },
    playlistItems: async () => [{ videoId: 'abcdefghijk', title: 'Fixture', description: '', channelTitle: 'Curated', publishedAt: '2026-01-01T12:00:00Z', thumbnailUrl: '', position: 0 }],
    verifyStored: async (exclude) => { assert.deepEqual(exclude, ['abcdefghijk']); return { videoIds: ['lmnopqrstuv', 'wxyz1234567'], nextAfterVideoId: 'wxyz1234567' }; },
    videoDetails: async (ids, opts) => { calls.push('details'); assert.equal(opts.revalidate, 0); assert.deepEqual(ids, ['abcdefghijk', 'lmnopqrstuv', 'wxyz1234567']); return [publicVideo(), { ...publicVideo('lmnopqrstuv'), privacyStatus: 'private' }]; },
    persist: async () => { assert.fail('scheduled snapshots cannot use unfenced upsert'); },
    reconcile: async (snapshot) => { calls.push('reconcile'); assert.deepEqual(snapshot.unavailableVideoIds, ['lmnopqrstuv', 'wxyz1234567']); assert.equal(snapshot.verificationCursor, 'wxyz1234567'); assert.equal(snapshot.publicVideos.length, 1); return { persisted: 1, unavailable: 2 }; },
  };
  return { deps, calls };
}

test('stored old uploads rotate through exact-ID verification and persist a complete public/unavailable partition', async () => {
  const setup = fixture();
  const report = await syncRecentYouTubeUploads(setup.deps);
  assert.equal(report.ok, true); assert.equal(report.totals.storedVideoIdsRechecked, 2); assert.equal(report.totals.videosMarkedUnavailable, 2);
  assert.equal(report.totals.searchCallsAttempted, 0);
  assert.ok(setup.calls.indexOf('begin') < setup.calls.indexOf('channels'));
  assert.ok(setup.calls.indexOf('details') < setup.calls.indexOf('reconcile'));
});

test('a details outage never turns requested old IDs into unavailable or advances the cursor', async () => {
  const setup = fixture();
  setup.deps.videoDetails = async () => { throw new Error('offline'); };
  const report = await syncRecentYouTubeUploads(setup.deps);
  assert.equal(report.ok, false); assert.equal(report.totals.videosMarkedUnavailable, 0);
  assert.equal(setup.calls.includes('reconcile'), false);
});

test('foreign curated-channel identity is rejected without changing any stored availability', async () => {
  const setup = fixture();
  setup.deps.videoDetails = async () => [{ ...publicVideo(), channelId: 'unapproved' }];
  const report = await syncRecentYouTubeUploads(setup.deps);
  assert.equal(report.ok, false); assert.equal(setup.calls.includes('reconcile'), false);
});

test('an already cancelled job cannot allocate an observation or call providers', async () => {
  const setup = fixture();
  const controller = new AbortController(); controller.abort(new Error('shutdown'));
  setup.deps.signal = controller.signal;
  await assert.rejects(syncRecentYouTubeUploads(setup.deps), /shutdown/);
  assert.deepEqual(setup.calls, []);
});

test('unknown privacy is an invalid details snapshot and cannot hide an existing public row', async () => {
  const setup = fixture();
  setup.deps.videoDetails = async () => [{ ...publicVideo(), privacyStatus: 'unknown' }];
  const report = await syncRecentYouTubeUploads(setup.deps);
  assert.equal(report.ok, false);
  assert.equal(setup.calls.includes('reconcile'), false);
  assert.equal(report.totals.videosMarkedUnavailable, 0);
});
