import { createHash } from 'node:crypto';
import { COMMONS_THUMB_WIDTHS, commonsThumbUrl } from '@apex/api-client/wikimedia';
import { APEX_USER_AGENT } from '@apex/api-client/user-agent';
import { COMMONS_PROXY_PREFIX, COMMONS_UPSTREAM_ORIGIN } from './commons-proxy';

/**
 * Server side of the first-party Commons image path (final audit F-11).
 *
 * Only the real Commons layout is accepted, so the route cannot be used to
 * fetch anything else: the hash directories must equal the MD5 of the file
 * name (how Commons stores files), thumbnails must use a width Commons
 * actually serves, and only raster images (or an SVG rendered as PNG) pass.
 * The upstream response is re-served with only the image bytes, its type and
 * cache headers: Wikimedia's Set-Cookie never reaches the browser.
 */

const SEGMENT = /^[A-Za-z0-9%._\-~!$&'()*+,;=:@]+$/;
const RASTER = /\.(?:jpe?g|png|webp|gif)$/i;
const SVG = /\.svg$/i;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const WIDTHS = new Set<number>(COMMONS_THUMB_WIDTHS);
/** Largest body re-served (Commons originals of circuit photos are a few MB). */
export const COMMONS_PROXY_MAX_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

function decodedName(segment: string): string | null {
  if (!SEGMENT.test(segment)) return null;
  let name: string;
  try { name = decodeURIComponent(segment); } catch { return null; }
  if (!name || name.length > 240 || /[/\\#?<>[\]{}|\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') return null;
  return name;
}

function hashDirs(name: string): [string, string] {
  const md5 = createHash('md5').update(name).digest('hex');
  return [md5[0]!, md5.slice(0, 2)];
}

/**
 * The upstream URL for a first-party path below `/media/commons/` (the raw,
 * still percent-encoded pathname), or null when it is not a genuine Commons
 * image path.
 */
export function commonsUpstreamUrl(pathname: string): string | null {
  if (typeof pathname !== 'string' || !pathname.startsWith(COMMONS_PROXY_PREFIX)) return null;
  const parts = pathname.slice(COMMONS_PROXY_PREFIX.length).split('/');
  if (parts.some((part) => !part || !SEGMENT.test(part))) return null;

  if (parts[0] === 'filepath' && parts.length === 3) {
    const width = Number(parts[1]);
    const name = decodedName(parts[2]!);
    if (!name || !Number.isInteger(width) || width <= 0 || width > 4096) return null;
    if (!RASTER.test(name) && !SVG.test(name)) return null;
    return commonsThumbUrl(name, width);
  }

  if (parts[0] === 'thumb' && parts.length === 5) {
    const [, a, ab, file, variant] = parts as [string, string, string, string, string];
    const name = decodedName(file);
    if (!name || (!RASTER.test(name) && !SVG.test(name))) return null;
    const [ha, hab] = hashDirs(name);
    if (a !== ha || ab !== hab) return null;
    const match = variant.match(/^(\d+)px-(.+)$/);
    if (!match || !WIDTHS.has(Number(match[1]))) return null;
    const expected = SVG.test(name) ? `${file}.png` : file;
    if (match[2] !== expected) return null;
    return `${COMMONS_UPSTREAM_ORIGIN}thumb/${a}/${ab}/${file}/${variant}`;
  }

  if (parts.length === 3) {
    const [a, ab, file] = parts as [string, string, string];
    const name = decodedName(file);
    if (!name || !RASTER.test(name)) return null;
    const [ha, hab] = hashDirs(name);
    if (a !== ha || ab !== hab) return null;
    return `${COMMONS_UPSTREAM_ORIGIN}${a}/${ab}/${file}`;
  }
  return null;
}

const CACHE_OK = 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400';
const CACHE_MISSING = 'public, max-age=3600, s-maxage=3600';

function failure(status: number, cache: string): Response {
  return new Response(null, { status, headers: { 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });
}

/** Caps a streamed body, erroring the stream past `limit` bytes. */
function capped(body: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) controller.error(new Error('Commons image exceeds the size limit'));
      else controller.enqueue(chunk);
    },
  }));
}

/** Fetch a Commons image server-side and re-serve only its bytes and type. */
export async function serveCommonsImage(pathname: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const upstream = commonsUpstreamUrl(pathname);
  if (!upstream) return failure(404, CACHE_MISSING);
  let response: Response;
  try {
    response = await fetcher(upstream, {
      headers: { 'User-Agent': APEX_USER_AGENT, Accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.9' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return failure(502, 'no-store');
  }
  if (response.status === 404 || response.status === 400) return failure(404, CACHE_MISSING);
  if (!response.ok || !response.body) return failure(502, 'no-store');
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) return failure(502, 'no-store');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > COMMONS_PROXY_MAX_BYTES) return failure(502, 'no-store');
  const headers = new Headers({
    'Content-Type': type,
    'Cache-Control': CACHE_OK,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  if (Number.isFinite(length) && length > 0) headers.set('Content-Length', String(length));
  return new Response(capped(response.body, COMMONS_PROXY_MAX_BYTES), { status: 200, headers });
}
