/**
 * Syndication-aware de-duplication for the homepage wire. Motorsport.com and
 * Autosport (and other networks) publish the same article under two URLs,
 * sometimes with a reworded headline and the same photograph on a different
 * CDN shard. A story is a repeat when it shares its URL slug, its picture,
 * or most of its headline words with one already shown. The first (newest)
 * copy wins; nothing is merged or rewritten.
 */

export interface StoryIdentity {
  href: string;
  title: string;
  image?: string | null;
}

/** "max-verstappen-puzzled-by-q3" from ".../news/max-verstappen-puzzled-by-q3/10868113/?utm=…". */
export function storySlug(href: string): string | null {
  try {
    const parts = new URL(href).pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
    const slug = [...parts].reverse().find((p) => /[a-z]/.test(p) && p.includes('-'));
    return slug && slug.length >= 16 ? slug.replace(/\.(html?|php)$/, '') : null;
  } catch {
    return null;
  }
}

/** Same picture on another CDN shard ("cdn-3." vs "cdn-9."), query strings ignored. */
export function imageIdentity(src?: string | null): string | null {
  if (!src) return null;
  try {
    const url = new URL(src);
    return `${url.hostname.replace(/^(?:cdn|img|images?|static)-?\d*\./, '')}${url.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'after', 'into', 'over', 'his', 'her', 'its', 'are', 'was', 'has', 'have', 'but', 'how', 'why', 'what', 'who', 'not', 'can', 'will']);

export function headlineWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/** Share of the shorter headline's words found in the other one. */
export function headlineOverlap(a: string, b: string): number {
  const wa = headlineWords(a);
  const wb = headlineWords(b);
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size < 4) return 0;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared += 1;
  return shared / small.size;
}

/** Repeats share a slug or a picture, or at least 70% of the shorter headline's words. */
export const SAME_STORY_OVERLAP = 0.7;

export function isSameStory(a: StoryIdentity, b: StoryIdentity): boolean {
  if (a.href === b.href) return true;
  const sa = storySlug(a.href);
  if (sa && sa === storySlug(b.href)) return true;
  const ia = imageIdentity(a.image);
  if (ia && ia === imageIdentity(b.image)) return true;
  return headlineOverlap(a.title, b.title) >= SAME_STORY_OVERLAP;
}

/** Keep the first copy of each story, in feed order. */
export function uniqueStories<T extends StoryIdentity>(stories: readonly T[]): T[] {
  const out: T[] = [];
  for (const s of stories) if (!out.some((kept) => isSameStory(kept, s))) out.push(s);
  return out;
}
