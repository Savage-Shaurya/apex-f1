import type { RssItem } from '@apex/api-client/rss';
import { classifyNewsItem } from '@apex/api-client/news-policy';
import { cleanHeadline, cleanSummary } from '@/components/news/news-format';
import { uniqueStories } from '@/components/home/stories';
import { bestRendition } from '@/lib/image-renditions';

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
/** The hero picks from this many newest stories, preferring sharp photos (never older ones). */
export const HERO_POOL = 16;
/** A photo at least this wide fills the full-bleed desktop frame sharply (The Race 2000 px originals). */
export const HERO_SHARP_WIDTH = 1600;
/** Below this share of the needed pixels a full-bleed photo reads as soft (SmartImage's own scale). */
export const HERO_SOFT_RATIO = 0.6;
/** Shape assumed for a photo covering the frame: publisher news photos are 3:2. */
const PHOTO_ASPECT = 1.5;

export interface HeroSlide {
  title: string;
  /** Short publisher standfirst, or null when the feed gave none worth showing. */
  standfirst: string | null;
  source: string;
  /** The publisher's article (the site links stories out, like /latest). */
  href: string;
  /** The publisher's own https picture. */
  image: string;
  /** The largest width (px) the publisher serves for the picture, or null when the host does not say. */
  imageWidth: number | null;
  publishedMs: number;
}

/**
 * The photo's true pixel width before anything loads: the host's known largest rendition
 * (lib/image-renditions: The Race 2000, motorsport.com 1200, F1 media 1920...), or a size the
 * publisher writes into the file name (ESPN `_1296x729_`). Null when unknown (WordPress originals).
 */
export function heroImageWidth(src: string): number | null {
  let rendition;
  try {
    new URL(src);
    rendition = bestRendition(src);
  } catch {
    return null;
  }
  if (rendition.maxWidth) return rendition.maxWidth;
  // The rendition rules strip WordPress thumbnail suffixes, so a size left in the URL is the file's own.
  if (rendition.src !== src) return null;
  let path = src;
  try { path = decodeURIComponent(src); } catch { /* keep the raw URL */ }
  const hint = path.match(/[_/](\d{3,4})x(\d{3,4})(?=[_.\-/])/);
  return hint ? Number(hint[1]) : null;
}

/** 0 = fills a desktop frame sharply, 1 = unknown, 2 = known to be small. */
function resolutionTier(width: number | null): 0 | 1 | 2 {
  if (width === null) return 1;
  return width >= HERO_SHARP_WIDTH ? 0 : 2;
}

/**
 * Wide screens (lg+) only: whether a photo can fill the full-bleed frame, or would be stretched
 * past {@link HERO_SOFT_RATIO} of its pixels and is shown framed at its own shape instead.
 * Unknown sizes are never guessed soft.
 */
export function heroPhotoMode({ imageWidth, frameWidth, frameHeight, dpr }: { imageWidth: number | null; frameWidth: number; frameHeight: number; dpr: number }): 'bleed' | 'framed' {
  if (!imageWidth || !Number.isFinite(dpr) || dpr <= 0 || !(frameWidth > 0)) return 'bleed';
  const drawnWidth = Math.max(frameWidth, (frameHeight > 0 ? frameHeight : 0) * PHOTO_ASPECT);
  return imageWidth / (drawnWidth * dpr) < HERO_SOFT_RATIO ? 'framed' : 'bleed';
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
      return { title, standfirst, source: item.source, href, image, imageWidth: heroImageWidth(image), publishedMs } satisfies HeroSlide;
    })
    .filter((s): s is HeroSlide => s !== null)
    .sort((a, b) => b.publishedMs - a.publishedMs);
  // From the newest stories only, the sharpest photos first (audit HNV-2): sharp, then unknown,
  // then known-small, newest first within each. Then the lead is the newest of the best photos
  // (it is the LCP and what most visitors see) and the rest run newest first.
  const pool = uniqueStories(candidates).slice(0, HERO_POOL);
  const chosen = pool
    .map((slide, order) => ({ slide, order, tier: resolutionTier(slide.imageWidth) }))
    .sort((a, b) => a.tier - b.tier || a.order - b.order)
    .slice(0, HERO_MAX_SLIDES);
  if (chosen.length < HERO_MIN_SLIDES) return null;
  const lead = chosen[0]!;
  const rest = chosen.slice(1).sort((a, b) => a.order - b.order);
  return [lead, ...rest].map((c) => c.slide);
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
