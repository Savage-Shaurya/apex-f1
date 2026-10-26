import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { YT_F1_CHANNELS, getF1ChannelDirectory, getF1Videos } from './index';

const originalKey = process.env.YOUTUBE_API_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = originalKey; });

test('the curated set no longer carries the old WTF1 id (now RAFA TV) and every channel has a unique slug', () => {
  assert.equal(YT_F1_CHANNELS.some((c) => c.channelId === 'UCDxm-FbK9nmZKqHI19j-DOw'), false);
  assert.equal(YT_F1_CHANNELS.some((c) => /wtf1/i.test(c.name)), false);
  assert.ok(YT_F1_CHANNELS.some((c) => c.channelId === 'UCB_qr75-ydFVKSF9Dmo6izg' && c.name === 'FORMULA 1'));
  const slugs = YT_F1_CHANNELS.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.every((slug) => slug && /^[a-z0-9-]+$/.test(slug)));
});

test('channel labels are the live channels.list snippet.title, not the configured name', async () => {
  process.env.YOUTUBE_API_KEY = 'disposable-test-key';
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.endsWith('/channels'), true);
    const ids = url.searchParams.get('id')!.split(',');
    return Response.json({ items: ids.map((id, i) => ({ id, snippet: { title: i === 0 ? 'FORMULA 1 (renamed by YouTube)' : `Live title ${i}` } })) });
  };
  const directory = await getF1ChannelDirectory({ fetchImpl });
  assert.equal(directory.length, YT_F1_CHANNELS.length);
  assert.equal(directory[0]!.title, 'FORMULA 1 (renamed by YouTube)');
  assert.ok(directory.every((c) => c.titleSource === 'youtube-api'));
});

test('without the Data API the verified fallback names are used and flagged as such', async () => {
  delete process.env.YOUTUBE_API_KEY;
  const directory = await getF1ChannelDirectory({ fetchImpl: async () => { throw new Error('no network call expected'); } });
  assert.deepEqual(directory.map((c) => c.title), YT_F1_CHANNELS.map((c) => c.name));
  assert.ok(directory.every((c) => c.titleSource === 'verified-fallback'));
});

test('channel-RSS videos take the channel name from the feed and drop other-series uploads', async () => {
  delete process.env.YOUTUBE_API_KEY;
  const atom = (author: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><title>Uploads</title>
    <entry><title>Kimi Antonelli, Max Verstappen &amp; Isack Hadjar react to United States GP Qualifying</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-10-25T10:00:00Z</published><author><name>${author}</name></author></entry>
    <entry><title>F1 Academy United States Grand Prix Race 2 | Highlights</title><link rel="alternate" href="https://www.youtube.com/watch?v=bcdefghijkl"/><published>2026-10-25T09:00:00Z</published><author><name>${author}</name></author></entry>
  </feed>`;
  const videos = await getF1Videos({ channels: [YT_F1_CHANNELS[1]!], fetchImpl: async () => new Response(atom('Sky Sports F1 (feed title)')) });
  assert.deepEqual(videos.map((v) => v.title), ['Kimi Antonelli, Max Verstappen & Isack Hadjar react to United States GP Qualifying']);
  assert.equal(videos[0]!.channelName, 'Sky Sports F1 (feed title)');
});
