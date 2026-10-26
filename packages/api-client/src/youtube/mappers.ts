/**
 * YouTube mappers · bridge raw Data API shapes (data-client.ts) into the
 * enriched UI shape used by render-path components.
 *
 * Two layers:
 *   YouTubeVideo          · channel-RSS-only baseline (no view counts, no duration).
 *                           Defined in ./index.ts. Always available.
 *   YouTubeVideoEnriched  · Data API extras layered on top. Only available when
 *                           YOUTUBE_API_KEY is present. Optional fields collapse
 *                           gracefully when stats are missing.
 *
 * Components should narrow with `isEnriched(v)` and read the extras only inside
 * that branch. UI shows view-count + exact duration only on the enriched path;
 * the RSS path keeps its current minimal chip ("FORMULA 1 · 2 days ago").
 */

import type { YTVideoDetail, YTChannelStats } from './data-client';

/** Enriched video · Data API guaranteed fields + channel stats decoration. */
export interface YouTubeVideoEnriched {
  videoId: string;
  title: string;
  url: string;
  channelId: string;
  channelName: string;
  channelThumbnail: string;
  channelSubscriberCount: number | null;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  publishedAt: string;
  publishedMs: number;
  description: string;
  /** YouTube status.embeddable · false means iframe will refuse to play. */
  embeddable: boolean;
  /** Region-blocked or non-public videos cannot be embedded. */
  privacyStatus: 'public' | 'unlisted' | 'private' | 'unknown';
  regionBlocked: boolean;
  regionRestriction?: { allowed?: string[]; blocked?: string[] };
  /** Discriminator the UI uses to opt into enriched fields. */
  enriched: true;
}

/** Discriminated-union helper for components consuming the mixed feed. */
export type AnyYouTubeVideo =
  | YouTubeVideoEnriched
  | (import('./index').YouTubeVideo & { enriched?: false });

export function isEnriched(v: AnyYouTubeVideo): v is YouTubeVideoEnriched {
  return Boolean((v as YouTubeVideoEnriched).enriched);
}

/** Build a watch-page URL from a videoId. */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Compact view-count label.
 *   1234        → "1.2K"
 *   1_234_000   → "1.2M"
 *   1_234_000_000 → "1.2B"
 */
export function formatCompactCount(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Unknown';
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

/**
 * Format duration in seconds → "MM:SS" or "H:MM:SS".
 *   65    → "1:05"
 *   3725  → "1:02:05"
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

/**
 * Compose a YTVideoDetail + (optional) channel-stats record into the enriched
 * UI shape. Channel-stat lookup is keyed off channelId.
 */
export function toEnrichedVideo(
  detail: YTVideoDetail,
  channelStatsById: Map<string, YTChannelStats>,
): YouTubeVideoEnriched {
  const ch = channelStatsById.get(detail.channelId);
  return {
    videoId: detail.videoId,
    title: detail.title,
    url: watchUrl(detail.videoId),
    channelId: detail.channelId,
    channelName: detail.channelTitle,
    channelThumbnail: ch?.thumbnailUrl ?? '',
    channelSubscriberCount: ch?.subscriberCount ?? null,
    thumbnailUrl:
      detail.thumbnailUrl ||
      `https://i.ytimg.com/vi/${detail.videoId}/hqdefault.jpg`,
    durationSeconds: detail.durationSeconds,
    viewCount: detail.viewCount,
    likeCount: detail.likeCount,
    commentCount: detail.commentCount,
    publishedAt: detail.publishedAt,
    publishedMs: Date.parse(detail.publishedAt) || 0,
    description: detail.description,
    embeddable: detail.embeddable,
    privacyStatus: detail.privacyStatus,
    regionBlocked: detail.regionBlocked,
    regionRestriction: detail.regionRestriction,
    enriched: true,
  };
}

/**
 * True when the video can be embedded in an iframe on third-party sites.
 *
 * RSS-fallback videos (where we have no Data API metadata) default to true -
 * we can't pre-check without spending a /videos.list unit per video, so we
 * optimistically allow the modal to attempt the embed and fall back gracefully
 * if YouTube refuses.
 *
 * Enriched videos use the live `status.embeddable` flag plus a region-block
 * check. Non-public videos are always rejected.
 */
export function canEmbed(v: AnyYouTubeVideo, regionCode?: string): boolean {
  if (!isEnriched(v)) return true;
  if (v.privacyStatus !== 'public' && v.privacyStatus !== 'unknown') return false;
  if (regionCode && v.regionRestriction) {
    const country = regionCode.toUpperCase();
    if (v.regionRestriction.blocked?.includes(country)) return false;
    if (v.regionRestriction.allowed && !v.regionRestriction.allowed.includes(country)) return false;
  } else if (v.regionBlocked) return false;
  return v.embeddable;
}

/** Build a Map for O(1) channel stat lookup by id. */
export function channelStatsMap(stats: YTChannelStats[]): Map<string, YTChannelStats> {
  return new Map(stats.map((s) => [s.channelId, s]));
}

/** Sort newest first by publishedMs. */
export function sortNewestFirst<T extends { publishedMs: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.publishedMs - a.publishedMs);
}

/** Sort by view count (enriched only · RSS fallback always sorts by date). */
export function sortMostViewed(items: YouTubeVideoEnriched[]): YouTubeVideoEnriched[] {
  return [...items].sort((a, b) => {
    if (a.viewCount === null) return b.viewCount === null ? 0 : 1;
    if (b.viewCount === null) return -1;
    return b.viewCount - a.viewCount;
  });
}
