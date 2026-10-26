/**
 * Wikimedia Commons image client: file identity, scaled thumbnails and the
 * author/licence metadata Commons publishes for every file.
 *
 * Thumbnails: since 2025 the upload servers only render a fixed set of
 * widths. Any other `/thumb/.../NNNpx-` width answers HTTP 400, and
 * `Special:FilePath?width=` silently returns the full original (often
 * several megabytes) once the requested width reaches the next bucket above
 * the original. Every thumbnail Apex builds therefore uses a bucket width on
 * the `/thumb/` path. Verified with curl on 2026-10-25: 60, 120, 250, 330,
 * 500, 960, 1280 and 1920 answer 200; 400, 640, 800, 1024, 1600 and 2000
 * answer 400.
 *
 * Network calls identify Apex with a contact User-Agent, as the Wikimedia
 * API etiquette requires (anonymous clients are rate limited with 429), and
 * are cached for 30 days: file metadata and P18 claims change rarely.
 */
import { createHash } from 'node:crypto';
import { requestJson, type ProviderRequestOptions } from '../transport';
import { APEX_USER_AGENT } from '../user-agent';

export const COMMONS_THUMB_WIDTHS = [250, 330, 500, 960, 1280, 1920] as const;

const USER_AGENT = APEX_USER_AGENT;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const THIRTY_DAYS = 30 * 86_400;
const REQUEST_TIMEOUT_MS = 4_000;
const RASTER = /\.(?:jpe?g|png|webp|gif)$/i;
const THUMBNAILABLE = /\.(?:jpe?g|png|webp|gif|svg)$/i;
const COMMONS_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

export type CommonsFetchOptions = ProviderRequestOptions & { revalidate?: number };

/** Smallest served bucket that covers `width`, never above what the original can supply. */
export function commonsBucket(width: number, originalWidth?: number | null): number {
  const wanted = Number.isFinite(width) && width > 0 ? width : 960;
  const target = originalWidth && Number.isFinite(originalWidth) && originalWidth > 0 ? Math.min(wanted, originalWidth) : wanted;
  return COMMONS_THUMB_WIDTHS.find((bucket) => bucket >= target) ?? COMMONS_THUMB_WIDTHS[COMMONS_THUMB_WIDTHS.length - 1]!;
}

function cleanName(raw: string): string | null {
  let name: string;
  try { name = decodeURIComponent(raw); } catch { return null; }
  name = name.replace(/^(?:File|Image):/i, '').replace(/ /g, '_').trim();
  if (!name || name.length > 240 || /[/\\#?<>[\]{}|\u0000-\u001f\u007f]/.test(name)) return null;
  return THUMBNAILABLE.test(name) ? name : null;
}

/**
 * Commons file name (underscored, decoded) from a `File:` title, a bare name,
 * a `Special:FilePath` URL or an upload/thumb URL. Files hosted on a single
 * wiki (`/wikipedia/en/...`, usually non-free) are rejected.
 */
export function commonsFileName(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return cleanName(value);
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.hostname === 'commons.wikimedia.org') {
    const match = url.pathname.match(/^\/wiki\/Special:FilePath\/(.+)$/) ?? url.pathname.match(/^\/wiki\/File:(.+)$/);
    return match?.[1] ? cleanName(match[1]) : null;
  }
  if (!COMMONS_HOSTS.has(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'wikipedia' || parts[1] !== 'commons') return null;
  // /wikipedia/commons/a/ab/File.jpg or /wikipedia/commons/thumb/a/ab/File.jpg/960px-File.jpg
  const file = parts[2] === 'thumb' ? parts[5] : parts[4];
  return file ? cleanName(file) : null;
}

function hashPath(name: string): string {
  const md5 = createHash('md5').update(name).digest('hex');
  return `${md5[0]}/${md5.slice(0, 2)}`;
}

/** A bucketed `/thumb/` URL. SVGs render as PNG; non-image files return null. */
export function commonsThumbUrl(fileName: string, width: number, originalWidth?: number | null): string | null {
  const name = cleanName(fileName);
  if (!name) return null;
  const bucket = commonsBucket(width, originalWidth);
  const encoded = encodeURIComponent(name);
  const suffix = /\.svg$/i.test(name) ? '.png' : '';
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${hashPath(name)}/${encoded}/${bucket}px-${encoded}${suffix}`;
}

export function commonsFilePageUrl(fileName: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName)}`;
}

export interface CommonsImage {
  fileName: string;
  /** The Commons file description page (author, licence, history). */
  pageUrl: string;
  width: number | null;
  height: number | null;
  mime: string | null;
  /** Plain-text author as published by Commons, or null when absent. */
  author: string | null;
  /** Short licence name, e.g. "CC BY-SA 4.0" or "Public domain". */
  license: string | null;
  licenseUrl: string | null;
  /** Plain-text description (English when available), trimmed. */
  description: string | null;
  /** Commons categories without the "Category:" prefix. */
  categories: string[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Commons metadata values are HTML fragments; reduce them to short plain text. */
export function plainText(html: unknown, max = 160): string | null {
  if (typeof html !== 'string') return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      const key = code.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key]!;
      if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16) || 32);
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)) || 32);
      return entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Author without the talk-page signature timestamp some uploads carry. */
export function authorName(html: unknown): string | null {
  const text = plainText(html, 160);
  if (!text) return null;
  const cleaned = text.replace(/\s*\d{1,2}:\d{2},\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*\(UTC\)\s*$/, '').trim();
  if (!cleaned) return null;
  return cleaned.length > 120 ? `${cleaned.slice(0, 119).trimEnd()}…` : cleaned;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.replace(/^http:/, 'https:') : null;
  } catch { return null; }
}

interface ImageInfoResponse {
  query?: {
    pages?: Array<{
      title?: string;
      missing?: boolean;
      categories?: Array<{ title?: string }>;
      imageinfo?: Array<{
        width?: number;
        height?: number;
        mime?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: unknown }>;
      }>;
    }>;
  };
}

/** File size, type, author, licence, description and categories. Null on any failure. */
export async function getCommonsImage(input: string, options: CommonsFetchOptions = {}): Promise<CommonsImage | null> {
  const fileName = commonsFileName(input);
  if (!fileName) return null;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo|categories',
    iiprop: 'size|mime|url|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ImageDescription',
    iiextmetadatalanguage: 'en',
    clshow: '!hidden',
    cllimit: '50',
    titles: `File:${fileName}`,
  });
  try {
    const json = await requestJson<ImageInfoResponse>('wikimedia', `${COMMONS_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: options.revalidate ?? THIRTY_DAYS },
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, ...options });
    const page = json.query?.pages?.[0];
    const info = page?.imageinfo?.[0];
    if (!page || page.missing || !info) return null;
    const meta = info.extmetadata ?? {};
    return {
      fileName,
      pageUrl: safeHttpUrl(info.descriptionurl) ?? commonsFilePageUrl(fileName),
      width: typeof info.width === 'number' && info.width > 0 ? info.width : null,
      height: typeof info.height === 'number' && info.height > 0 ? info.height : null,
      mime: typeof info.mime === 'string' ? info.mime : null,
      author: authorName(meta['Artist']?.value),
      license: plainText(meta['LicenseShortName']?.value, 60),
      licenseUrl: safeHttpUrl(meta['LicenseUrl']?.value),
      description: plainText(meta['ImageDescription']?.value, 220),
      categories: (page.categories ?? [])
        .map((c) => (typeof c.title === 'string' ? c.title.replace(/^Category:/, '') : ''))
        .filter(Boolean),
    };
  } catch {
    return null;
  }
}

interface EntitiesResponse {
  entities?: Record<string, { missing?: string; claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }>;
}

/** Wikidata P18 ("image") of the item linked to an English Wikipedia article. */
export async function getEnwikiP18(articleTitle: string, options: CommonsFetchOptions = {}): Promise<string | null> {
  const title = articleTitle.replace(/#.*$/, '').replace(/_/g, ' ').trim();
  if (!title || title.length > 250) return null;
  const params = new URLSearchParams({
    action: 'wbgetentities', format: 'json', sites: 'enwiki', titles: title, props: 'claims', redirects: 'yes',
  });
  try {
    const json = await requestJson<EntitiesResponse>('wikimedia', `${WIKIDATA_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      next: { revalidate: options.revalidate ?? THIRTY_DAYS },
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: 4_000_000, ...options });
    for (const entity of Object.values(json.entities ?? {})) {
      if (entity.missing !== undefined) continue;
      const value = entity.claims?.['P18']?.[0]?.mainsnak?.datavalue?.value;
      if (typeof value === 'string') return commonsFileName(value);
    }
    return null;
  } catch {
    return null;
  }
}

export function isRasterCommonsFile(fileName: string): boolean {
  return RASTER.test(fileName);
}
