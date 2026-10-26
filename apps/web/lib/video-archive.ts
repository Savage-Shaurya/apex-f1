import { getF1Videos, watchUrl, type GetF1VideosOpts, type YouTubeVideo, type YouTubeVideoEnriched } from '@apex/api-client/youtube';
import { listStoredPublicVideos, type StoredVideo } from '@apex/db';

/**
 * /video fallback source (BE-7). youtube-sync persists a verified snapshot of
 * the curated channels' public uploads; until now no page read it. When the
 * YouTube Data API and the channel RSS fallback both return nothing, pages show
 * that saved copy instead of an empty state, and say so: these are real videos
 * from the last successful sync, not a live list.
 */
export type StoredVideoFeed =
  | { status: 'available'; videos: YouTubeVideo[]; newestPublishedAt: string }
  | { status: 'unavailable'; reason: 'not-configured' | 'empty' | 'error' };

type Reader = (input: { limit?: number; channelNames?: string[] }) => Promise<StoredVideo[]>;

export function storedVideoToFeedItem(row: StoredVideo): YouTubeVideo {
  return {
    videoId: row.videoId,
    title: row.title,
    url: watchUrl(row.videoId),
    // The stored thumbnail is YouTube's own; hqdefault is YouTube's standard still for the same video.
    thumbnailUrl: row.thumbnailUrl ?? `https://i.ytimg.com/vi/${row.videoId}/hqdefault.jpg`,
    channelName: row.channelName ?? 'YouTube',
    publishedAt: row.publishedAt,
    publishedMs: Date.parse(row.publishedAt),
  };
}

export async function getStoredF1Videos(
  input: { limit?: number; channelNames?: string[] } = {},
  read: Reader = listStoredPublicVideos,
): Promise<StoredVideoFeed> {
  if (read === listStoredPublicVideos && !process.env.DATABASE_URL) return { status: 'unavailable', reason: 'not-configured' };
  try {
    const rows = await read({ limit: Math.max(1, Math.min(100, input.limit ?? 24)), channelNames: input.channelNames });
    const videos = rows.map(storedVideoToFeedItem).filter((video) => Number.isFinite(video.publishedMs));
    if (!videos.length) return { status: 'unavailable', reason: 'empty' };
    const newest = Math.max(...videos.map((video) => video.publishedMs));
    return { status: 'available', videos, newestPublishedAt: new Date(newest).toISOString() };
  } catch {
    return { status: 'unavailable', reason: 'error' };
  }
}

export interface F1VideoFeed {
  videos: Array<YouTubeVideo | YouTubeVideoEnriched>;
  /** 'youtube': live Data API or channel RSS. 'saved-copy': the last verified sync. 'none': nothing to show. */
  source: 'youtube' | 'saved-copy' | 'none';
  /** For 'saved-copy': the newest upload in it, so the page can say how recent the copy is. */
  savedCopyNewestPublishedAt?: string;
}

/**
 * Drop-in for getF1Videos on /video (and home): live first, then the saved
 * copy. Channel filters use the same channel titles the sync stored.
 */
export async function getF1VideosWithSavedCopy(
  opts: GetF1VideosOpts = {},
  deps: { live?: typeof getF1Videos; read?: Reader } = {},
): Promise<F1VideoFeed> {
  const live = await (deps.live ?? getF1Videos)(opts).catch(() => []);
  if (live.length) return { videos: live, source: 'youtube' };
  const channelNames = opts.channels?.map((channel) => channel.name).filter(Boolean);
  const stored = await getStoredF1Videos({ limit: opts.limit, channelNames }, deps.read);
  if (stored.status === 'available') return { videos: stored.videos, source: 'saved-copy', savedCopyNewestPublishedAt: stored.newestPublishedAt };
  return { videos: [], source: 'none' };
}
