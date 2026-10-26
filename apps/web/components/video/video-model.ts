import { canEmbed, formatCompactCount, formatDuration, isEnriched, type AnyYouTubeVideo } from '@apex/api-client/youtube';
import { headlineSignals } from '@apex/api-client/news-policy';
import { decodeEntities } from '@/lib/format';
import { joinNames } from '@/components/news/news-format';

/**
 * One video as the pages render it. Every field comes from YouTube (Data API
 * when keyed, channel RSS otherwise); fields the source did not supply stay
 * null and are simply not printed.
 */
export interface VideoView {
  key: string;
  videoId: string | null;
  url: string;
  title: string;
  channel: string;
  publishedMs: number;
  thumbnail: string;
  /** "12:34", or null when YouTube did not supply a duration. */
  duration: string | null;
  /** Spoken duration for assistive tech: "12 minutes 34 seconds". */
  durationSpoken: string | null;
  /** "1.2M views", "Views hidden" when YouTube withholds the count, null on the RSS path. */
  views: string | null;
  viewCount: number | null;
  /** Plays in the on-site player (YouTube allows embedding); otherwise opens at YouTube. */
  embeddable: boolean;
  /** YouTube limits the video to some countries, so it may not play for every reader. */
  regionLimited: boolean;
  /**
   * Plays on Apex in all but a handful of countries: embeddable, not limited
   * to an allow-list, and blocked in at most MAX_BLOCKED_COUNTRIES.
   */
  widelyPlayable: boolean;
  /** Honest region note from YouTube's own restriction: "Not available in Belarus and Russia". */
  regionNote: string | null;
}

/** A video blocked in this many countries or fewer still counts as playing for (nearly) everyone. */
export const MAX_BLOCKED_COUNTRIES = 5;

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Describe YouTube's regionRestriction in words, or null when the video plays everywhere. */
export function describeRegion(restriction: { allowed?: string[]; blocked?: string[] } | undefined, regionBlocked = false): string | null {
  if (restriction?.allowed) {
    const n = restriction.allowed.length;
    return n === 0 ? 'Not available in any country' : `Plays in only ${n} ${n === 1 ? 'country' : 'countries'}`;
  }
  const blocked = restriction?.blocked ?? [];
  if (blocked.length > 0) {
    return blocked.length <= MAX_BLOCKED_COUNTRIES
      ? `Not available in ${joinNames([...blocked].map(countryName).sort((a, b) => a.localeCompare(b)))}`
      : `Not available in ${blocked.length} countries`;
  }
  return regionBlocked ? 'Not available in some countries' : null;
}

const YOUTUBE_ID = /^[\w-]{11}$/;

export function spokenDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.floor(seconds);
  const parts: string[] = [];
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (sec && !h) parts.push(`${sec} second${sec === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function toVideoView(v: AnyYouTubeVideo): VideoView {
  const enriched = isEnriched(v);
  const videoId = v.videoId && YOUTUBE_ID.test(v.videoId) ? v.videoId : null;
  const duration = enriched ? formatDuration(v.durationSeconds) || null : null;
  const embeddable = Boolean(videoId) && canEmbed(v);
  const restriction = enriched ? v.regionRestriction : undefined;
  const blockedCount = restriction?.blocked?.length ?? 0;
  return {
    key: videoId ?? v.url,
    videoId,
    url: v.url,
    title: decodeEntities(v.title).replace(/\s+/g, ' ').trim(),
    channel: v.channelName,
    publishedMs: v.publishedMs,
    thumbnail: v.thumbnailUrl || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : ''),
    duration,
    durationSpoken: enriched ? spokenDuration(v.durationSeconds) : null,
    // A public video at 0 views is a stream or premiere that has not started: print nothing rather than "0 views".
    views: enriched ? (v.viewCount === null ? 'Views hidden by YouTube' : v.viewCount > 0 ? `${formatCompactCount(v.viewCount)} views` : null) : null,
    viewCount: enriched ? v.viewCount : null,
    embeddable,
    regionLimited: enriched ? Boolean(v.regionBlocked || blockedCount || restriction?.allowed) : false,
    widelyPlayable: embeddable && !(enriched && v.regionBlocked) && !restriction?.allowed && blockedCount <= MAX_BLOCKED_COUNTRIES,
    regionNote: enriched ? describeRegion(restriction, v.regionBlocked) : null,
  };
}

/**
 * The video to feature: the first (in the page's order) that plays on Apex
 * for (nearly) every reader, so the page's biggest element is never a poster
 * most people cannot play. Formula 1's own uploads qualify (YouTube blocks
 * them in two countries, which the page says); broadcaster clips limited to
 * a few countries do not. A finished video beats an unstarted stream.
 * Falls back to the first video when none qualifies.
 */
export function pickFeatured<T extends Pick<VideoView, 'widelyPlayable' | 'duration'>>(videos: readonly T[]): T | undefined {
  return videos.find((v) => v.widelyPlayable && v.duration !== null)
    ?? videos.find((v) => v.widelyPlayable)
    ?? videos[0];
}

/**
 * Channels that also cover road cars and other motorsport (Driver61's
 * engineering films). Their uploads need a positive Formula 1 signal in the
 * title (F1, Grand Prix, a team, driver or F1 term), on top of the shared
 * policy that already removes other series.
 */
export const BROAD_CHANNEL_SLUGS: ReadonlySet<string> = new Set(['driver61']);

export function isOnTopicForChannel(title: string, channelSlug: string | undefined): boolean {
  if (!channelSlug || !BROAD_CHANNEL_SLUGS.has(channelSlug)) return true;
  const signals = headlineSignals(title);
  return signals.strictF1 || signals.grandPrix || signals.context;
}

/**
 * One accessible name for a play link, built in one piece (final audit F-13:
 * names used to start with a stray ": " and the running time was a separate
 * ", 28 seconds" fragment elsewhere in the card). The verb comes first and
 * matches the visible label ("Play video" on the featured button), then the
 * title, then the spoken running time when YouTube supplied one. A link that
 * leaves the site says so.
 *   "Play: Bono Gets Drenched!, 28 seconds"
 *   "Watch on YouTube: Onboard at Austin, 1 minute 5 seconds (opens in a new tab)"
 */
export function playName(v: Pick<VideoView, 'title' | 'durationSpoken' | 'embeddable'>, verb?: string): string {
  const action = verb ?? (v.embeddable ? 'Play' : 'Watch on YouTube');
  const title = v.title.replace(/\s+/g, ' ').trim();
  const time = v.durationSpoken ? `, ${v.durationSpoken}` : '';
  return `${action}: ${title}${time}${v.embeddable ? '' : ' (opens in a new tab)'}`;
}

/** Attributes the shared VideoPlayerModal listens for (keep this contract). */
export function playerAttributes(v: VideoView): Record<string, string | undefined> {
  return {
    'data-apex-video-id': v.embeddable && v.videoId ? v.videoId : undefined,
    'data-apex-video-title': v.title,
    'data-apex-video-channel': v.channel,
    // The poster sits in the player frame while YouTube loads, so opening a video never flashes black.
    'data-apex-video-poster': v.embeddable && v.videoId ? v.thumbnail || undefined : undefined,
  };
}
