import type { RssItem } from '@apex/api-client/rss';
import { classifyNewsItem } from '@apex/api-client/news-policy';
import { cleanHeadline, cleanSummary } from '@/components/news/news-format';
import { uniqueStories } from '@/components/home/stories';

/**
 * The home hero's rotating news desk: the newest real Formula 1 stories from
 * the feed the site already reads (lib/home-feed), each with the publisher's
 * own picture. Pure and synchronous so the selection is tested with real
 * shapes; the page decides on the server and the client only rotates.
 */

/** Stories the hero rotates through (the original hero cycled eight). */
export const HERO_MAX_SLIDES = 8;
/** Fewer than this is not a carousel: the page keeps its race-weekend hero. */
export const HERO_MIN_SLIDES = 3;
/** Each story holds the screen this long while the rotation runs. */
export const HERO_SLIDE_MS = 6000;

export interface HeroSlide {
  title: string;
  /** Short publisher standfirst, or null when the feed gave none worth showing. */
  standfirst: string | null;
  source: string;
  /** The publisher's article (the site links stories out, like /latest). */
  href: string;
  /** The publisher's own https picture. */
  image: string;
  publishedMs: number;
}

const STANDFIRST_MAX = 180;

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  const base = (space > max * 0.6 ? cut.slice(0, space) : text.slice(0, max)).replace(/[\s,;:.\-–—]+$/, '');
  return `${base}…`;
}

function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Newest first, Formula 1 only (the news policy is re-checked here, so a
 * stray row can never headline the home page), one copy per syndicated
 * story, English, with a real picture and a past publish time. Returns null
 * when fewer than {@link HERO_MIN_SLIDES} stories qualify, or the read failed.
 */
export function selectHeroSlides(feed: readonly RssItem[] | null | undefined, now: number): HeroSlide[] | null {
  if (!feed?.length) return null;
  const candidates = feed
    .map((item) => {
      const href = httpsUrl(item.link);
      const image = httpsUrl(item.imageUrl);
      const title = cleanHeadline(item.title, item.source);
      const publishedMs = Number.isFinite(item.pubDateMs) ? item.pubDateMs : 0;
      if (!href || !image || !title || publishedMs <= 0 || publishedMs > now + 60_000) return null;
      if (item.language && item.language !== 'en') return null;
      if (!classifyNewsItem({ title, link: href, description: item.description, categories: item.categories, provider: item.provider }).allowed) return null;
      const summary = cleanSummary(item.description);
      const standfirst = summary && words(summary) !== words(title) && !words(title).startsWith(words(summary)) ? trim(summary, STANDFIRST_MAX) : null;
      return { title, standfirst, source: item.source, href, image, publishedMs } satisfies HeroSlide;
    })
    .filter((s): s is HeroSlide => s !== null)
    .sort((a, b) => b.publishedMs - a.publishedMs);
  const slides = uniqueStories(candidates).slice(0, HERO_MAX_SLIDES);
  return slides.length >= HERO_MIN_SLIDES ? slides : null;
}

/** The rotation runs only with motion allowed, nothing pausing it and more than one story. */
export function autoAdvances({ reducedMotion, paused, count }: { reducedMotion: boolean; paused: boolean; count: number }): boolean {
  return !reducedMotion && !paused && count > 1;
}

/** Next or previous slide, wrapping at both ends. */
export function stepSlide(index: number, by: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return (((index + by) % count) + count) % count;
}
