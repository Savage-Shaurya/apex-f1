/**
 * Wikimedia Commons photos are delivered from Apex's own origin.
 *
 * A browser that loads an image straight from upload.wikimedia.org receives
 * Wikimedia's `WMF-Uniq` cookie (one year, before any consent) and hands
 * Wikimedia the visitor's IP address (final audit F-11). Every Commons URL a
 * page renders is therefore rewritten to `/media/commons/...`, which
 * app/media/commons/[...path]/route.ts fetches server-side and serves without
 * any upstream cookie. This module is browser-safe (no node:crypto); the
 * strict path validation lives in lib/commons-proxy-server.ts.
 *
 *   https://upload.wikimedia.org/wikipedia/commons/<path>      -> /media/commons/<path>
 *   https://thumb.wikimedia.org/wikipedia/commons/<path>       -> /media/commons/<path>
 *   https://commons.wikimedia.org/wiki/Special:FilePath/<file>?width=<w>
 *                                                              -> /media/commons/filepath/<w>/<file>
 */

export const COMMONS_PROXY_PREFIX = '/media/commons/';
export const COMMONS_UPSTREAM_ORIGIN = 'https://upload.wikimedia.org/wikipedia/commons/';
const UPLOAD_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

/** The first-party URL for a Commons image URL; any other URL is returned unchanged. */
export function firstPartyImageUrl(src: string): string {
  if (typeof src !== 'string' || !/^(?:https?:)?\/\//i.test(src.trim())) return src;
  let url: URL;
  try { url = new URL(src.trim().startsWith('//') ? `https:${src.trim()}` : src.trim()); } catch { return src; }
  const host = url.hostname.toLowerCase();
  if (UPLOAD_HOSTS.has(host) && url.pathname.startsWith('/wikipedia/commons/')) {
    return `${COMMONS_PROXY_PREFIX}${url.pathname.slice('/wikipedia/commons/'.length)}`;
  }
  if (host === 'commons.wikimedia.org') {
    const match = url.pathname.match(/^\/wiki\/Special:FilePath\/([^/]+)$/);
    if (match?.[1]) {
      const width = Number(url.searchParams.get('width'));
      return `${COMMONS_PROXY_PREFIX}filepath/${Number.isInteger(width) && width > 0 ? width : 960}/${match[1]}`;
    }
  }
  return src;
}

/**
 * A srcset with every Commons candidate rewritten to the first-party path.
 * Candidate URLs end at whitespace (HTML srcset rules) and may themselves
 * contain commas (Cloudinary transforms), so tokens are split on whitespace,
 * never on commas; descriptors such as `330w,` are left untouched.
 */
export function firstPartySrcSet(srcSet: string): string {
  return srcSet.replace(/\S+/g, (token) => {
    const url = token.replace(/,+$/, '');
    const mapped = firstPartyImageUrl(url);
    return mapped === url ? token : `${mapped}${token.slice(url.length)}`;
  });
}

/** The upstream Commons URL behind a first-party `/media/commons/` thumb or original path (not `filepath/`). */
export function upstreamOfFirstParty(src: string): string | null {
  if (typeof src !== 'string' || !src.startsWith(COMMONS_PROXY_PREFIX)) return null;
  const rest = src.slice(COMMONS_PROXY_PREFIX.length);
  if (!rest || rest.startsWith('filepath/')) return null;
  return `${COMMONS_UPSTREAM_ORIGIN}${rest}`;
}
