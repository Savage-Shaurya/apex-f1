/**
 * YouTube provider · two-tier strategy.
 *
 *  Tier 1 (preferred): YouTube Data API v3 via ./data-client
 *      Activated when process.env.YOUTUBE_API_KEY is set. Gives real view
 *      counts, exact durations, subscriber counts, and channel thumbnails.
 *      Quota-budgeted: render-path uses /videos (1 unit) + /channels (1 unit),
 *      both with long Next.js caches. /search is cron-only.
 *
 *  Tier 2 (fallback): channel-RSS via youtube.com/feeds/videos.xml
 *      Activated automatically when YOUTUBE_API_KEY is missing. Free, no key,
 *      no quota · but no view counts, no duration, no subscriber data. UI
 *      degrades gracefully via the `enriched` discriminator in mappers.ts.
 *
 *  getF1Videos() picks the tier at call time. Per project rule #1 (NO mock
 *  data), if the Data API errors out and RSS also returns empty, the function
 *  returns [] and the caller renders the empty state.
 */

import { getRssFeed, type RssItem } from '../rss';
import { VIDEO_CACHE_TAG } from '../cache-tags';
export { VIDEO_CACHE_TAG } from '../cache-tags';
import {
  getChannelStats,
  getPlaylistItems,
  getVideoDetails,
  hasYouTubeApiKey,
  type YTPlaylistItem,
  type YouTubeFetchOpts,
} from './data-client';
import { isF1VideoTitle } from '../news-policy';
import {
  channelStatsMap,
  sortNewestFirst,
  toEnrichedVideo,
  type YouTubeVideoEnriched,
} from './mappers';

// ─── RSS-baseline types (unchanged public surface) ──────────────────────────

export interface YouTubeVideo {
  videoId: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  channelName: string;
  publishedAt: string;
  publishedMs: number;
  description?: string;
}

export interface YouTubeChannelSource {
  /** Stable URL key for /video?channel=. Never shown to readers. Required for curated channels. */
  slug?: string;
  /**
   * The channel's YouTube title as verified with channels.list on the date
   * below. Pages show the live API title (getF1ChannelDirectory); this value is
   * only the fallback when the Data API cannot be reached.
   */
  name: string;
  channelId: string;
}

/**
 * Curated F1 channels. Each id was checked with the YouTube Data API
 * (channels.list snippet.title + the latest uploads) on 2026-10-25:
 *
 *   FORMULA 1      UCB_qr75-ydFVKSF9Dmo6izg  @formula1       official F1 channel
 *   Sky Sports F1  UC3kxJQ9RfaS5CKeYbbFMi4Q  @skysportsf1    F1 broadcaster (also posts F1 Academy; filtered per video)
 *   Chain Bear     UC7u-Dg0jb7g9s7XjmtJrtpg  @chainbear      F1 explainers
 *   Driver61       UCtbLA0YM6EpwUQhFUyPQU9Q  @driver61       F1 engineering
 *   Tommo          UCFHaLSX-Kqy5pGTszklkE8w  @tommomccluskey F1 race previews and reports
 *
 * Removed: UCDxm-FbK9nmZKqHI19j-DOw, listed here as "WTF1", is now "RAFA TV"
 * (GT4/NASCAR lifestyle films, not F1), and @wtf1 resolves to an unrelated
 * 11-subscriber channel. Re-verify with docs/NEWS-POLICY.md before adding one.
 */
export const YT_F1_CHANNELS: YouTubeChannelSource[] = [
  { slug: 'formula-1', name: 'FORMULA 1', channelId: 'UCB_qr75-ydFVKSF9Dmo6izg' },
  { slug: 'sky-sports-f1', name: 'Sky Sports F1', channelId: 'UC3kxJQ9RfaS5CKeYbbFMi4Q' },
  { slug: 'chain-bear', name: 'Chain Bear', channelId: 'UC7u-Dg0jb7g9s7XjmtJrtpg' },
  { slug: 'driver61', name: 'Driver61', channelId: 'UCtbLA0YM6EpwUQhFUyPQU9Q' },
  { slug: 'tommo', name: 'Tommo', channelId: 'UCFHaLSX-Kqy5pGTszklkE8w' },
];

export interface F1ChannelEntry extends YouTubeChannelSource {
  slug: string;
  /** Label to show: the live YouTube title, or the verified fallback. */
  title: string;
  titleSource: 'youtube-api' | 'verified-fallback';
}

/**
 * Channel labels for pages. Titles come from channels.list snippet.title
 * (1 quota unit, cached 7 days). When the Data API key is missing or the call
 * fails, the verified fallback names above are used and marked as such.
 */
export async function getF1ChannelDirectory(opts: YouTubeFetchOpts & { channels?: YouTubeChannelSource[] } = {}): Promise<F1ChannelEntry[]> {
  const channels = opts.channels ?? YT_F1_CHANNELS;
  const stats = hasYouTubeApiKey() ? await getChannelStats(channels.map((c) => c.channelId), { ...opts, strict: false }) : [];
  const titles = new Map(stats.filter((s) => s.title.trim()).map((s) => [s.channelId, s.title.trim()]));
  return channels.map((c) => {
    const live = titles.get(c.channelId);
    return { ...c, slug: c.slug ?? c.channelId, title: live ?? c.name, titleSource: live ? 'youtube-api' : 'verified-fallback' };
  });
}

// ─── Re-exports ─────────────────────────────────────────────────────────────

export * from './data-client';
export * from './mappers';

// ─── RSS path ───────────────────────────────────────────────────────────────

function videoIdFromAtomLink(link: string): string {
  const m = link.match(/[?&]v=([\w-]+)/);
  return m?.[1] ?? '';
}

function bestThumb(videoId: string, fallback?: string): string {
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return fallback ?? '';
}

async function fetchChannelFeed(
  ch: YouTubeChannelSource,
  revalidate: number,
  opts: YouTubeFetchOpts = {},
): Promise<YouTubeVideo[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
  const items = await getRssFeed(
    { name: ch.name, url, homepage: 'https://www.youtube.com' },
    { ...opts, revalidate, cacheTags: [VIDEO_CACHE_TAG, 'videos:rss'] },
  );
  return items.map((it: RssItem): YouTubeVideo => {
    const videoId = videoIdFromAtomLink(it.link);
    return {
      videoId,
      title: it.title,
      url: it.link,
      thumbnailUrl: bestThumb(videoId, it.imageUrl),
      // The Atom feed's <author><name> is the channel's own current title.
      channelName: it.author?.trim() || ch.name,
      publishedAt: it.pubDate,
      publishedMs: it.pubDateMs,
      description: it.description,
    };
  });
}

/** Aggregate via channel-RSS only. Always works, no key required. */
async function getF1VideosViaRss(opts: YouTubeFetchOpts & {
  limit?: number;
  channels?: YouTubeChannelSource[];
  revalidate?: number;
}): Promise<YouTubeVideo[]> {
  const channels = opts.channels ?? YT_F1_CHANNELS;
  const revalidate = opts.revalidate ?? 1800;
  const results = await Promise.all(channels.map((c) => fetchChannelFeed(c, revalidate, opts)));
  const merged = results.flat().filter((v) => isF1VideoTitle(v.title));
  merged.sort((a, b) => b.publishedMs - a.publishedMs);
  return opts.limit ? merged.slice(0, opts.limit) : merged;
}

// ─── Data API path ──────────────────────────────────────────────────────────

/**
 * Quota-cheap latest-uploads via the channel's "uploads" playlist:
 *   /channels.list (1 unit, batched, cached 7d)  → uploads playlist ids
 *   /playlistItems.list (1 unit/channel, cached 1h) → recent video ids
 *   /videos.list (1 unit, batched 50, cached 24h) → durations + stats
 *
 * Total at warm cache: 0 units. Cold: ~ N+1+1 units for N channels. With our
 * 5-channel curated set that is 7 units in the worst case · versus 500 units
 * if we used /search per channel. The cron also uses uploads playlists;
 * search is retained only as an explicit provider tool.
 */
async function getF1VideosViaDataApi(opts: YouTubeFetchOpts & {
  limit?: number;
  channels?: YouTubeChannelSource[];
}): Promise<YouTubeVideoEnriched[]> {
  const channels = opts.channels ?? YT_F1_CHANNELS;
  const perChannel = Math.max(opts.limit ?? 16, 8);

  // 1. Channel stats · gives us uploads playlist id + subscriber/thumb decoration.
  const stats = await getChannelStats(channels.map((c) => c.channelId), opts);
  if (stats.length === 0) return [];
  const statsById = channelStatsMap(stats);

  // 2. Pull recent items from each channel's uploads playlist.
  const playlistResults = await Promise.all(
    stats
      .filter((s) => s.uploadsPlaylistId)
      .map((s) => getPlaylistItems(s.uploadsPlaylistId, perChannel, opts)),
  );
  const playlistItems: YTPlaylistItem[] = playlistResults.flat();
  if (playlistItems.length === 0) return [];

  // 3. Fetch durations + statistics in batches of 50.
  const allVideoIds = playlistItems.map((p) => p.videoId).filter(Boolean);
  const details = await getVideoDetails(allVideoIds, opts);
  if (details.length === 0) return [];

  // 4. Map → enriched UI shape, sort newest first.
  // Curated channels are trusted, but some also post other series (F1 Academy).
  const enriched = details.filter((d) => isF1VideoTitle(d.title)).map((d) => toEnrichedVideo(d, statsById));
  const sorted = sortNewestFirst(enriched);

  // 5. Round-robin balance across channels.
  // Without this, the most prolific channel (e.g. FORMULA 1 official, which
  // uploads several times per day) drowns out the smaller editorial channels
  // (Chain Bear, Tommo, Driver61) in a strict newest-first sort. We end up
  // with a Featured rail that is 100% FOM-embed-blocked content. The round
  // robin walks each channel in turn, taking one video at a time, until we
  // either run out of videos or reach the limit.
  if (opts.limit && opts.limit < sorted.length) {
    const byChannel = new Map<string, YouTubeVideoEnriched[]>();
    for (const v of sorted) {
      const bucket = byChannel.get(v.channelId) ?? [];
      bucket.push(v);
      byChannel.set(v.channelId, bucket);
    }
    const queues = Array.from(byChannel.values());
    const balanced: YouTubeVideoEnriched[] = [];
    while (balanced.length < opts.limit && queues.some((q) => q.length > 0)) {
      for (const queue of queues) {
        if (balanced.length >= opts.limit) break;
        const next = queue.shift();
        if (next) balanced.push(next);
      }
    }
    return balanced;
  }

  return sorted;
}

// ─── Public entry point ─────────────────────────────────────────────────────

export interface GetF1VideosOpts extends YouTubeFetchOpts {
  limit?: number;
  channels?: YouTubeChannelSource[];
  /** Revalidate hint for the RSS fallback path. Ignored on Data API path. */
  revalidate?: number;
  /** Force RSS path even if YOUTUBE_API_KEY is set (useful for tests). */
  forceRss?: boolean;
}

/**
 * Aggregate latest videos across the curated F1 channel set.
 *
 *   - When YOUTUBE_API_KEY is present (and forceRss is false): returns
 *     YouTubeVideoEnriched[] · real view counts, exact duration, subscriber
 *     counts. Components should narrow with `isEnriched(v)`.
 *   - When the key is missing OR the Data API call returns empty (quota /
 *     network error): falls back to channel-RSS and returns YouTubeVideo[].
 *     UI gets fewer fields but the page still renders.
 *
 * Return type is the discriminated-union AnyYouTubeVideo[] so callers can
 * keep one rendering code path.
 */
export async function getF1Videos(
  opts: GetF1VideosOpts = {},
): Promise<Array<YouTubeVideo | YouTubeVideoEnriched>> {
  const useDataApi = !opts.forceRss && hasYouTubeApiKey();

  if (useDataApi) {
    const enriched = await getF1VideosViaDataApi({
      ...opts,
      limit: opts.limit,
      channels: opts.channels,
    });
    if (opts.strict || enriched.length > 0) return enriched;
    // Data API returned nothing (quota, key invalid, channels missing). Fall through.
  }

  return getF1VideosViaRss({
    ...opts,
    limit: opts.limit,
    channels: opts.channels,
    revalidate: opts.revalidate,
  });
}
