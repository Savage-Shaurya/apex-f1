import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StoredVideo } from '@apex/db';
import { getF1VideosWithSavedCopy, getStoredF1Videos, storedVideoToFeedItem } from './video-archive';

// Test rows only: shaped like the stored youtube-sync snapshot.
const row = (videoId: string, publishedAt: string, extra: Partial<StoredVideo> = {}): StoredVideo => ({
  videoId, title: `Fixture ${videoId}`, thumbnailUrl: null, channelName: 'FORMULA 1', publishedAt, durationSeconds: 300, ...extra,
});

test('stored rows map to feed items with YouTube watch and thumbnail URLs', () => {
  const item = storedVideoToFeedItem(row('abcdefghijk', '2026-10-25T01:15:23.000Z'));
  assert.equal(item.url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(item.thumbnailUrl, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  assert.equal(item.publishedMs, Date.parse('2026-10-25T01:15:23.000Z'));
});

test('the saved copy reports its newest upload, and empty or failing storage is an honest unavailable state', async () => {
  const feed = await getStoredF1Videos({ limit: 10 }, async () => [row('aaaaaaaaaaa', '2026-10-20T00:00:00.000Z'), row('bbbbbbbbbbb', '2026-10-25T00:00:00.000Z')]);
  assert.equal(feed.status, 'available');
  assert.equal(feed.status === 'available' && feed.newestPublishedAt, '2026-10-25T00:00:00.000Z');
  assert.deepEqual(await getStoredF1Videos({}, async () => []), { status: 'unavailable', reason: 'empty' });
  assert.deepEqual(await getStoredF1Videos({}, async () => { throw new Error('database down'); }), { status: 'unavailable', reason: 'error' });
});

test('/video uses live YouTube first and the saved copy only when live returns nothing', async () => {
  const live = [{ ...storedVideoToFeedItem(row('ccccccccccc', '2026-10-26T00:00:00.000Z')) }];
  let reads = 0;
  const read = async (input: { channelNames?: string[] }) => { reads++; assert.deepEqual(input.channelNames, ['FORMULA 1']); return [row('ddddddddddd', '2026-10-25T00:00:00.000Z')]; };
  const fresh = await getF1VideosWithSavedCopy({ channels: [{ name: 'FORMULA 1', slug: 'f1' } as never] }, { live: async () => live, read });
  assert.equal(fresh.source, 'youtube'); assert.equal(reads, 0);
  const saved = await getF1VideosWithSavedCopy({ channels: [{ name: 'FORMULA 1', slug: 'f1' } as never] }, { live: async () => [], read });
  assert.equal(saved.source, 'saved-copy'); assert.equal(saved.videos[0]?.videoId, 'ddddddddddd');
  assert.equal(saved.savedCopyNewestPublishedAt, '2026-10-25T00:00:00.000Z');
  const none = await getF1VideosWithSavedCopy({}, { live: async () => { throw new Error('quota'); }, read: async () => [] });
  assert.deepEqual(none, { videos: [], source: 'none' });
});
