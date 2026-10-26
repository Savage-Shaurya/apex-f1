import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getChannelStats, getPlaylistItems, getVideoDetails } from './data-client';

const originalKey = process.env.YOUTUBE_API_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = originalKey; });
test('explicit YouTube ingestion bypasses all three render caches while default reads retain their policies', async () => {
  process.env.YOUTUBE_API_KEY = 'disposable-test-key';
  const calls: Array<{ endpoint: string; revalidate: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const endpoint = new URL(String(input)).pathname.split('/').at(-1)!;
    calls.push({ endpoint, revalidate: (init as RequestInit & { next?: { revalidate?: number } })?.next?.revalidate });
    if (endpoint === 'channels') return Response.json({ items: [{ id: 'fixture_channel', snippet: { title: 'Fixture' }, contentDetails: { relatedPlaylists: { uploads: 'fixture_uploads' } } }] });
    if (endpoint === 'playlistItems') return Response.json({ items: [{ snippet: { title: 'Fixture', resourceId: { videoId: 'abcdefghijk' } } }] });
    return Response.json({ items: [{ id: 'abcdefghijk', snippet: { title: 'Fixture', publishedAt: '2026-01-01T12:00:00Z', channelId: 'fixture_channel', channelTitle: 'Fixture' }, status: { privacyStatus: 'public', embeddable: true }, contentDetails: { duration: 'PT10S' } }] });
  };
  for (const revalidate of [0, undefined]) {
    const opts = { strict: true, fetchImpl, revalidate };
    await getChannelStats(['fixture_channel'], opts);
    await getPlaylistItems('fixture_uploads', 50, opts);
    await getVideoDetails(['abcdefghijk'], opts);
  }
  assert.deepEqual(calls.slice(0, 3).map((call) => call.revalidate), [0, 0, 0]);
  assert.deepEqual(calls.slice(3).map((call) => call.revalidate), [604_800, 3_600, 86_400]);
});
