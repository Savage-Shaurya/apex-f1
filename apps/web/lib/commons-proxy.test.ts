import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { bestRendition } from './image-renditions';
import { firstPartyImageUrl, firstPartySrcSet } from './commons-proxy';
import { commonsUpstreamUrl, serveCommonsImage } from './commons-proxy-server';
import { commonsDisplayUrl } from './commons-image';
import { isPhotograph } from './f1-media-urls';

/**
 * F-11 (final audit 2026-10-26): hot-linked Commons images made the browser
 * contact upload.wikimedia.org, which set a one-year `WMF-Uniq` cookie before
 * any consent. Every Commons image is now delivered from Apex's own origin
 * (/media/commons/...), fetched server-side without forwarding any cookie.
 */

const WIKIMEDIA = /wikimedia\.org/;
const COTA = 'Circuit_of_the_americas_cota_(52781066233).jpg';
const md5 = (name: string) => createHash('md5').update(name).digest('hex');
const dirs = (name: string) => `${md5(name)[0]}/${md5(name).slice(0, 2)}`;
const allUrls = (r: { src: string; srcSet?: string; fallbacks?: string[] }) => [r.src, ...(r.srcSet ?? '').split(','), ...(r.fallbacks ?? [])].filter(Boolean);

test('the renditions the browser receives for a Commons photo never point at a Wikimedia host', () => {
  const thumb = `https://upload.wikimedia.org/wikipedia/commons/thumb/${dirs(COTA)}/${COTA}/960px-${COTA}`;
  for (const input of [
    thumb,
    `https://thumb.wikimedia.org/wikipedia/commons/thumb/${dirs(COTA)}/${COTA}/330px-${COTA}`,
    `https://upload.wikimedia.org/wikipedia/commons/${dirs(COTA)}/${COTA}`,
    `https://commons.wikimedia.org/wiki/Special:FilePath/${COTA}`,
  ]) {
    const r = bestRendition(input);
    for (const url of allUrls(r)) assert.doesNotMatch(url, WIKIMEDIA, `${input} -> ${url}`);
    assert.ok(r.src.startsWith('/media/commons/'), r.src);
  }
  // With a known original width the bucket list and the original stay available, first-party.
  const sized = bestRendition(thumb, { intrinsicWidth: 1600 });
  assert.equal(sized.srcSet, [330, 500, 960, 1280].map((w) => `/media/commons/thumb/${dirs(COTA)}/${COTA}/${w}px-${COTA} ${w}w`).concat(`/media/commons/${dirs(COTA)}/${COTA} 1600w`).join(', '));
  // An already first-party path keeps its responsive srcset.
  const again = bestRendition(sized.src, { intrinsicWidth: 1600 });
  assert.equal(again.srcSet, sized.srcSet);
  assert.equal(isPhotograph(sized.src), true, 'first-party Commons photos are still photographs');
});

test('server-built Commons photo URLs (circuit heroes, portraits) are first-party', () => {
  const src = commonsDisplayUrl(COTA, 1920, 4000);
  assert.equal(src, `/media/commons/thumb/${dirs(COTA)}/${encodeURIComponent(COTA)}/1920px-${encodeURIComponent(COTA)}`);
  assert.equal(commonsDisplayUrl('not-an-image.pdf', 960), null);
});

test('firstPartyImageUrl rewrites only Commons URLs', () => {
  assert.equal(firstPartyImageUrl('https://media.formula1.com/image/upload/x.jpg'), 'https://media.formula1.com/image/upload/x.jpg');
  assert.equal(firstPartyImageUrl('https://upload.wikimedia.org/wikipedia/en/a/ab/NonFree.jpg'), 'https://upload.wikimedia.org/wikipedia/en/a/ab/NonFree.jpg');
  assert.equal(firstPartyImageUrl('https://commons.wikimedia.org/wiki/Special:FilePath/A_b.jpg?width=500'), '/media/commons/filepath/500/A_b.jpg');
  assert.equal(firstPartySrcSet('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/330px-X.jpg 330w, https://i.ytimg.com/vi/x/hq.jpg 480w'),
    '/media/commons/thumb/a/ab/X.jpg/330px-X.jpg 330w, https://i.ytimg.com/vi/x/hq.jpg 480w');
  // Cloudinary candidates contain commas inside the URL and must pass through byte for byte.
  const cloudinary = 'https://media.formula1.com/image/upload/c_fill,g_north,w_320/x.webp 320w, https://media.formula1.com/image/upload/c_fill,g_north,w_640/x.webp 640w';
  assert.equal(firstPartySrcSet(cloudinary), cloudinary);
});

test('the first-party route accepts only genuine Commons image paths', () => {
  const ok = `/media/commons/thumb/${dirs(COTA)}/${COTA}/960px-${COTA}`;
  assert.equal(commonsUpstreamUrl(ok), `https://upload.wikimedia.org/wikipedia/commons/thumb/${dirs(COTA)}/${COTA}/960px-${COTA}`);
  assert.equal(commonsUpstreamUrl(`/media/commons/${dirs(COTA)}/${COTA}`), `https://upload.wikimedia.org/wikipedia/commons/${dirs(COTA)}/${COTA}`);
  assert.match(commonsUpstreamUrl(`/media/commons/filepath/500/${COTA}`) ?? '', /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\/500px-/);
  for (const bad of [
    `/media/commons/thumb/0/00/${COTA}/960px-${COTA}`, // hash directories that are not the file's MD5
    `/media/commons/thumb/${dirs(COTA)}/${COTA}/640px-${COTA}`, // a width Commons does not serve
    `/media/commons/thumb/${dirs(COTA)}/${COTA}/960px-Other.jpg`, // a variant of another file
    `/media/commons/${dirs('x.pdf')}/x.pdf`, // not an image
    '/media/commons/../../etc/passwd',
    '/media/commons/thumb/a/ab/%2e%2e/960px-%2e%2e',
    '/media/commons/',
    '/media/other/x.jpg',
  ]) assert.equal(commonsUpstreamUrl(bad), null, bad);
});

test('the route re-serves only the image: no upstream cookie, long cache, identified User-Agent', async () => {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const upstream = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: {
      'content-type': 'image/jpeg', 'content-length': '3',
      'set-cookie': 'WMF-Uniq=abc; Domain=.wikimedia.org; Max-Age=31536000; HttpOnly', 'x-cache': 'hit',
    } });
  }) as typeof fetch;
  const res = await serveCommonsImage(`/media/commons/thumb/${dirs(COTA)}/${COTA}/960px-${COTA}`, upstream);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null, 'Wikimedia cookie never forwarded');
  assert.equal(res.headers.get('x-cache'), null, 'only the image headers are re-served');
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control') ?? '', /public, .*s-maxage=\d{6,}/);
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0xff, 0xd8, 0xff]);
  assert.equal(seen.length, 1);
  assert.match(String((seen[0]!.init?.headers as Record<string, string>)['User-Agent']), /^Apex\//);
  assert.equal((seen[0]!.init?.headers as Record<string, string>).Cookie, undefined);

  let calls = 0;
  const never = (async () => { calls++; return new Response(''); }) as typeof fetch;
  assert.equal((await serveCommonsImage('/media/commons/thumb/0/00/X.jpg/960px-X.jpg', never)).status, 404);
  assert.equal(calls, 0, 'an invalid path never reaches Wikimedia');

  const html = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
  assert.equal((await serveCommonsImage(`/media/commons/${dirs(COTA)}/${COTA}`, html)).status, 502, 'non-image upstream bodies are refused');
  const missing = (async () => new Response('', { status: 404 })) as typeof fetch;
  assert.equal((await serveCommonsImage(`/media/commons/${dirs(COTA)}/${COTA}`, missing)).status, 404);
  const down = (async () => { throw new Error('offline'); }) as typeof fetch;
  const failed = await serveCommonsImage(`/media/commons/${dirs(COTA)}/${COTA}`, down);
  assert.equal(failed.status, 502);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
});
