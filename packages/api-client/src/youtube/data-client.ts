/**
 * YouTube Data API v3 client.
 *
 * Quota model:
 *   Project allocation must be checked in its Cloud Console. Current default
 *   documentation gives search.list a separate 100-call/day bucket; other
 *   endpoints below share the default 10,000-unit/day bucket.
 *     /videos.list      → 1 unit per call, up to 50 ids batched
 *     /channels.list    → 1 unit per call, up to 50 ids batched
 *     /playlistItems.list → 1 unit per call
 *
 * Budgeting rules enforced here:
 *   1. /search is NEVER called from a render path or the scheduled sync. Both
 *      readers and the job use uploads playlists. Search is an explicit tool;
 *      scheduled public-video persistence uses provider-keyed stable rows.
 *   2. /videos and /channels are cheap (1 unit) and wrapped in long-lived
 *      Next.js fetch caches so render-path traffic does not burn quota.
 *   3. Every call is wrapped in try/catch. On error we return [] so a quota
 *      exhaustion never breaks the page; the channel-RSS fallback path picks
 *      up in apps/web via index.ts.
 *
 * Auth: API key in `key` query param (header auth requires OAuth).
 * Base: https://www.googleapis.com/youtube/v3
 */


/** Cap upstream latency so a stalled provider cannot pin a serverless function. */
import { ProviderError, failOr, isRecord, requestJson, withProviderDeadline, type ProviderRequestOptions } from '../transport';
import { VIDEO_CACHE_TAG } from '../cache-tags';

const REQUEST_TIMEOUT_MS = 8000;
const BASE = 'https://www.googleapis.com/youtube/v3';

// ─── Public result types ────────────────────────────────────────────────────

export interface YTSearchResult {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string; // ISO-8601
  thumbnailUrl: string;
}

export interface YTVideoDetail {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  durationSeconds: number; // parsed from ISO-8601 contentDetails.duration
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  tags: string[];
  categoryId: string;
  /** YouTube status.embeddable · false means iframe will refuse to play. */
  embeddable: boolean;
  /** YouTube status.privacyStatus · only 'public' videos are safely embeddable. */
  privacyStatus: 'public' | 'unlisted' | 'private' | 'unknown';
  /** YouTube contentDetails.regionRestriction · if present, embed is region-gated. */
  regionBlocked: boolean;
  regionRestriction?: { allowed?: string[]; blocked?: string[] };
}

export interface YTChannelStats {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number | null;
  videoCount: number | null;
  viewCount: number | null;
  uploadsPlaylistId: string;
}

export interface YTPlaylistItem {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  position: number;
}

// ─── Raw API shapes (mirror YouTube payloads exactly) ───────────────────────

interface RawThumb {
  url: string;
  width?: number;
  height?: number;
}

interface RawThumbnails {
  default?: RawThumb;
  medium?: RawThumb;
  high?: RawThumb;
  standard?: RawThumb;
  maxres?: RawThumb;
}

interface RawSearchItem {
  id: { kind: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet: {
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    thumbnails: RawThumbnails;
  };
}

interface RawSearchResponse {
  items?: RawSearchItem[];
  nextPageToken?: string;
  pageInfo?: { totalResults: number; resultsPerPage: number };
  error?: { code: number; message: string };
}

interface RawVideoItem {
  id: string;
  snippet?: {
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description: string;
    thumbnails: RawThumbnails;
    tags?: string[];
    categoryId?: string;
  };
  contentDetails?: {
    duration: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
    uploadStatus?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}

interface RawVideosResponse {
  items?: RawVideoItem[];
  error?: { code: number; message: string };
}

interface RawChannelItem {
  id: string;
  snippet?: {
    title: string;
    description: string;
    thumbnails: RawThumbnails;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
    viewCount?: string;
  };
}

interface RawChannelsResponse {
  items?: RawChannelItem[];
  error?: { code: number; message: string };
}

interface RawPlaylistItem {
  snippet?: {
    publishedAt: string;
    title: string;
    description: string;
    channelTitle: string;
    position: number;
    resourceId?: { kind: string; videoId?: string };
    thumbnails: RawThumbnails;
  };
}

interface RawPlaylistResponse {
  items?: RawPlaylistItem[];
  nextPageToken?: string;
  error?: { code: number; message: string };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickThumb(t: RawThumbnails | undefined): string {
  if (!t) return '';
  return (
    t.maxres?.url ??
    t.standard?.url ??
    t.high?.url ??
    t.medium?.url ??
    t.default?.url ??
    ''
  );
}

/**
 * Parse ISO-8601 duration (PT#H#M#S) → seconds.
 * Examples: PT15M33S → 933, PT1H2M3S → 3723, P1DT2H → 93600.
 */
export function parseISO8601Duration(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function toInt(s: string | undefined): number | null {
  if (typeof s !== 'string' || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getKey(): string {
  return process.env.YOUTUBE_API_KEY ?? '';
}

export interface YouTubeFetchOpts extends ProviderRequestOptions {
  strict?: boolean;
  /** Explicit ingestion can bypass render caches; ordinary reads keep their defaults. */
  revalidate?: number;
  /** Viewer ISO 3166-1 alpha-2 country, when known. */
  regionCode?: string;
}
interface InternalFetchOpts extends YouTubeFetchOpts {
  /** Next.js ISR revalidate seconds. */
  revalidate: number;
}

function validSnippet(value: unknown, video: boolean): boolean {
  if (!isRecord(value) || typeof value.title !== 'string') return false;
  if (['description','channelTitle','publishedAt','channelId'].some(key => value[key] !== undefined && typeof value[key] !== 'string')) return false;
  if (video && ['publishedAt','channelId','channelTitle'].some(key => typeof value[key] !== 'string')) return false;
  if (value.thumbnails !== undefined && (!isRecord(value.thumbnails) || Object.values(value.thumbnails).some(thumb => !isRecord(thumb) || typeof thumb.url !== 'string'))) return false;
  return true;
}

function validItem(path: string, item: Record<string, unknown>): boolean {
  if (path === 'search') return isRecord(item.id) && typeof item.id.videoId === 'string' && validSnippet(item.snippet, true);
  if (path === 'playlistItems') return validSnippet(item.snippet, false) && isRecord(item.snippet) && isRecord(item.snippet.resourceId) && typeof item.snippet.resourceId.videoId === 'string';
  if (typeof item.id !== 'string' || !validSnippet(item.snippet, path === 'videos')) return false;
  if (item.contentDetails !== undefined && !isRecord(item.contentDetails)) return false;
  if (item.statistics !== undefined && !isRecord(item.statistics)) return false;
  if (path === 'videos') {
    if (item.status !== undefined && (!isRecord(item.status) || (item.status.embeddable !== undefined && typeof item.status.embeddable !== 'boolean'))) return false;
    const restriction = isRecord(item.contentDetails) ? item.contentDetails.regionRestriction : undefined;
    if (restriction !== undefined && (!isRecord(restriction) || ['allowed','blocked'].some(key => restriction[key] !== undefined && (!Array.isArray(restriction[key]) || restriction[key].some((country: unknown) => typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)))))) return false;
  }
  return true;
}

async function ytGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  opts: InternalFetchOpts,
): Promise<T | null> {
  const key = getKey();
  if (!key) return failOr('youtube', new ProviderError('youtube', 'configuration'), opts.strict, null);

  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('key', key);

  try {
    const json = await requestJson<unknown>('youtube', url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: opts.revalidate, tags: [VIDEO_CACHE_TAG, `videos:${path}`] },
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, ...opts });
    if (!isRecord(json) || json.error || !Array.isArray(json.items)) throw new ProviderError('youtube', 'invalid-response');
    if (json.items.some(item => !isRecord(item) || !validItem(path, item))) throw new ProviderError('youtube', 'invalid-response');
    return json as T;
  } catch (error) {
    return failOr('youtube', error, opts.strict, null);
  }
}

/** Maximum three in-flight batches and one deadline for the complete collection. */
async function ytBatches<T>(ids: string[], path: string, part: string, revalidate: number, opts: YouTubeFetchOpts): Promise<T[]> {
  if (ids.length > 500 || ids.some(id => !/^[A-Za-z0-9_-]+$/.test(id))) return failOr('youtube', new ProviderError('youtube', 'invalid-input'), opts.strict, []);
  try {
    return await withProviderDeadline('youtube', async signal => {
      const batches = chunk(ids, 50);
      const responses: T[] = new Array(batches.length);
      let cursor = 0;
      const worker = async () => {
        for (;;) {
          if (signal.aborted) throw new ProviderError('youtube', 'timeout');
          const index = cursor++;
          const batch = batches[index];
          if (!batch) return;
          const response = await ytGet<T>(path, { part, id: batch.join(','), maxResults: 50 }, { ...opts, signal, strict: true, revalidate });
          if (response === null) throw new ProviderError('youtube', 'invalid-response');
          responses[index] = response;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
      return responses;
    }, { ...opts, timeoutMs: opts.timeoutMs ?? REQUEST_TIMEOUT_MS });
  } catch (error) {
    return failOr('youtube', error, opts.strict, []);
  }
}

// ─── /search.list · separately allocated calls. CRON ONLY. ─────────────────

export interface SearchOpts extends YouTubeFetchOpts {
  /** Free-text query. Defaults to "Formula 1". */
  q?: string;
  /** Limit to a single channel (recommended). */
  channelId?: string;
  /** ISO date · videos published after this instant. */
  publishedAfter?: string;
  /** 1-50. Defaults to 25. */
  maxResults?: number;
  /** Order. Defaults to 'date' (newest first). */
  order?: 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount';
}

/**
 * /search.list consumes the project's search allocation.
 *
 * Do NOT call from render path. Use only from cron jobs. Cached 6h as a
 * belt-and-suspenders measure against accidental re-invocation.
 */
export async function searchYouTubeF1Videos(opts: SearchOpts = {}): Promise<YTSearchResult[]> {
  const data = await ytGet<RawSearchResponse>(
    'search',
    {
      part: 'snippet',
      type: 'video',
      q: opts.q ?? 'Formula 1',
      channelId: opts.channelId,
      publishedAfter: opts.publishedAfter,
      maxResults: Math.min(Math.max(opts.maxResults ?? 25, 1), 50),
      order: opts.order ?? 'date',
      safeSearch: 'none',
    },
    { ...opts, revalidate: 6 * 60 * 60 },
  );

  if (!data?.items) return [];

  return data.items
    .filter((it): it is RawSearchItem & { id: { videoId: string } } => Boolean(it.id?.videoId && it.snippet && typeof it.snippet.title === 'string'))
    .map((it) => ({
      videoId: it.id.videoId ?? '',
      channelId: it.snippet.channelId,
      channelTitle: it.snippet.channelTitle,
      title: it.snippet.title,
      description: it.snippet.description,
      publishedAt: it.snippet.publishedAt,
      thumbnailUrl: pickThumb(it.snippet.thumbnails),
    }));
}

// ─── /videos.list · 1 unit per call, batched 50 ids. ────────────────────────

/**
 * Fetch full video details (statistics + contentDetails) for up to N videos.
 * Auto-batches 50 ids per call. Cached 24h.
 */
export async function getVideoDetails(videoIds: string[], opts: YouTubeFetchOpts = {}): Promise<YTVideoDetail[]> {
  const ids = Array.from(new Set(videoIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const responses = await ytBatches<RawVideosResponse>(ids, 'videos', 'snippet,contentDetails,statistics,status', opts.revalidate ?? 24 * 60 * 60, opts);

  const out: YTVideoDetail[] = [];
  for (const data of responses) {
    if (!data?.items) continue;
    for (const it of data.items) {
      if (!it.snippet) continue;
      const rr = it.contentDetails?.regionRestriction;
      const privacy = it.status?.privacyStatus;
      const privacyStatus: 'public' | 'unlisted' | 'private' | 'unknown' =
        privacy === 'public' || privacy === 'unlisted' || privacy === 'private'
          ? privacy
          : 'unknown';
      out.push({
        videoId: it.id,
        title: it.snippet.title,
        description: it.snippet.description,
        channelId: it.snippet.channelId,
        channelTitle: it.snippet.channelTitle,
        publishedAt: it.snippet.publishedAt,
        thumbnailUrl: pickThumb(it.snippet.thumbnails),
        durationSeconds: parseISO8601Duration(it.contentDetails?.duration ?? ''),
        viewCount: toInt(it.statistics?.viewCount),
        likeCount: toInt(it.statistics?.likeCount),
        commentCount: toInt(it.statistics?.commentCount),
        tags: it.snippet.tags ?? [],
        categoryId: it.snippet.categoryId ?? '',
        // Default to true when status absent so we don't filter out the entire
        // RSS fallback path (which has no status data at all).
        embeddable: it.status?.embeddable ?? true,
        privacyStatus,
        regionBlocked: Boolean(opts.regionCode && (
          rr?.blocked?.includes(opts.regionCode.toUpperCase()) ||
          (rr?.allowed && !rr.allowed.includes(opts.regionCode.toUpperCase()))
        )),
        regionRestriction: rr,
      });
    }
  }
  return out;
}

// ─── /channels.list · 1 unit per call, batched 50 ids. ──────────────────────

/**
 * Fetch channel statistics (subscribers, totals, uploads playlist).
 * Cached 7 days · subscriber counts change slowly.
 */
export async function getChannelStats(channelIds: string[], opts: YouTubeFetchOpts = {}): Promise<YTChannelStats[]> {
  const ids = Array.from(new Set(channelIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const responses = await ytBatches<RawChannelsResponse>(ids, 'channels', 'snippet,contentDetails,statistics', opts.revalidate ?? 7 * 24 * 60 * 60, opts);

  const out: YTChannelStats[] = [];
  for (const data of responses) {
    if (!data?.items) continue;
    for (const it of data.items) {
      out.push({
        channelId: it.id,
        title: it.snippet?.title ?? '',
        description: it.snippet?.description ?? '',
        thumbnailUrl: pickThumb(it.snippet?.thumbnails),
        subscriberCount: it.statistics?.hiddenSubscriberCount ? null : toInt(it.statistics?.subscriberCount),
        videoCount: toInt(it.statistics?.videoCount),
        viewCount: toInt(it.statistics?.viewCount),
        uploadsPlaylistId: it.contentDetails?.relatedPlaylists?.uploads ?? '',
      });
    }
  }
  return out;
}

// ─── /playlistItems.list · 1 unit per call. ─────────────────────────────────

/**
 * Fetch items from a playlist. Used for "uploads" playlist of a channel,
 * which is a quota-cheap alternative to /search for recent uploads.
 */
export async function getPlaylistItems(
  playlistId: string,
  maxResults = 25,
  opts: YouTubeFetchOpts = {},
): Promise<YTPlaylistItem[]> {
  const data = await ytGet<RawPlaylistResponse>(
    'playlistItems',
    {
      part: 'snippet',
      playlistId,
      maxResults: Math.min(Math.max(maxResults, 1), 50),
    },
    { ...opts, revalidate: opts.revalidate ?? 60 * 60 },
  );

  if (!data?.items) return [];

  return data.items
    .filter((it) => Boolean(it.snippet?.resourceId?.videoId))
    .map((it) => ({
      videoId: it.snippet?.resourceId?.videoId ?? '',
      title: it.snippet?.title ?? '',
      description: it.snippet?.description ?? '',
      channelTitle: it.snippet?.channelTitle ?? '',
      publishedAt: it.snippet?.publishedAt ?? '',
      thumbnailUrl: pickThumb(it.snippet?.thumbnails),
      position: it.snippet?.position ?? 0,
    }));
}

/** Convenience: true if YOUTUBE_API_KEY is present in env. */
export function hasYouTubeApiKey(): boolean {
  return Boolean(getKey());
}
