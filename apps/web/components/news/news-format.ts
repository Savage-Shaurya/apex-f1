/**
 * Pure helpers for the news pages (/latest, /article, /newsletter preview).
 * Everything here is deterministic from its inputs (pass `now`), so pages can
 * render on the server without hydration drift and tests can pin the clock.
 */
import { decodeEntities } from '@/lib/format';
import { dayKeyIn, daysBetween } from './relative-age';

/** The time a server render is made (day labels such as "Today" are relative to it). */
export function renderTime(): number {
  return Date.now();
}

function alnum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Headline as a reader should see it: entities decoded, whitespace collapsed,
 * and a trailing " | Publisher" / " - Publisher" removed when the suffix is the
 * story's own publisher (the publisher is already printed beside it). Any other
 * suffix is part of the headline and is kept.
 */
export function cleanHeadline(title: string | null | undefined, source?: string | null): string {
  const text = decodeEntities(title ?? '').replace(/\s+/g, ' ').trim();
  // RaceFans tags every F1 story " | Formula 1": redundant on an F1-only page.
  const untagged = text.replace(/\s+\|\s+(?:Formula (?:1|One)|F1)$/i, '');
  if (!source) return untagged;
  const publisher = alnum(source);
  if (!publisher) return untagged;
  const match = untagged.match(/^(.*\S)\s+[|\-–—]\s+([^|\-–—]{2,60})$/);
  if (!match) return untagged;
  const suffix = alnum(match[2]!);
  if (suffix && (suffix === publisher || publisher.startsWith(suffix) || suffix.startsWith(publisher))) return match[1]!;
  return untagged;
}

/** Plain teaser text: decoded, tags removed, whitespace collapsed. */
export function cleanSummary(text: string | null | undefined): string {
  return decodeEntities((text ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "14:32 UTC". Empty for a missing or invalid time. */
export function utcClock(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** "Sun 25 Oct 2026, 14:32 UTC". */
export function utcStamp(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const date = new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${date}, ${utcClock(ms)}`;
}

/** "25 October 2026" in UTC. */
export function utcLongDate(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export { relativeAge, dayKeyIn } from './relative-age';

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** "2026-10-25" (UTC). */
export function utcDayKey(ms: number): string {
  return new Date(startOfUtcDay(ms)).toISOString().slice(0, 10);
}

/**
 * Day rule label: "Today", "Yesterday" or nothing, plus the full date, for a
 * calendar day key in `timeZone` (the viewer's zone on the client, R3-TIME-3).
 */
export function dayHeading(dayKey: string, now: number, timeZone?: string): { relative: string | null; date: string } {
  const ms = Date.parse(`${dayKey}T12:00:00Z`);
  const date = new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const diff = daysBetween(dayKey, dayKeyIn(now, timeZone));
  return { relative: diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : null, date };
}

/** Group items by calendar day in `timeZone`, keeping the incoming order inside and across days. */
export function groupByDay<T>(items: readonly T[], timeOf: (item: T) => number, timeZone?: string): Array<{ key: string; items: T[] }> {
  const groups: Array<{ key: string; items: T[] }> = [];
  const undated: T[] = [];
  for (const item of items) {
    const ms = timeOf(item);
    if (!ms || !Number.isFinite(ms)) { undated.push(item); continue; }
    const key = dayKeyIn(ms, timeZone);
    const existing = groups.at(-1)?.key === key ? groups.at(-1) : groups.find((g) => g.key === key);
    if (existing) existing.items.push(item);
    else groups.push({ key, items: [item] });
  }
  if (undated.length) groups.push({ key: 'undated', items: undated });
  return groups;
}

/** UTC grouping (what the server renders before the viewer's zone is known). */
export function groupByUtcDay<T>(items: readonly T[], timeOf: (item: T) => number): Array<{ key: string; items: T[] }> {
  return groupByDay(items, timeOf, 'UTC');
}

/** Clamp a requested page and slice it. Pages are 1-based. */
export function paginate<T>(
  items: readonly T[],
  requested: number,
  perPage: number,
  orphans = 0,
): { page: number; totalPages: number; slice: T[] } {
  let totalPages = Math.max(1, Math.ceil(items.length / perPage));
  // Orphan control: a last page shorter than `orphans` joins the page before it,
  // so "Older" never leads to a page with one or two stories.
  const lastCount = items.length - (totalPages - 1) * perPage;
  if (totalPages > 1 && lastCount < orphans) totalPages -= 1;
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : 1));
  const end = page === totalPages ? items.length : page * perPage;
  return { page, totalPages, slice: items.slice((page - 1) * perPage, end) };
}

/** Parse a ?page= value: a positive integer, else 1. */
export function parsePage(raw: string | null | undefined): number {
  if (!raw || !/^\d{1,4}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

export type StreamSlot = 'spread' | 'row' | 'text';

/**
 * Rhythm of the day-sectioned stream. Stories without a picture are text
 * rows. Among picture stories, every fourth one opens up as a full-width
 * spread (picture side alternating), the rest sit two to a row.
 */
export function streamLayout(hasImage: readonly boolean[]): Array<{ slot: StreamSlot; flip: boolean }> {
  let pictures = 0;
  let spreads = 0;
  return hasImage.map((image) => {
    if (!image) return { slot: 'text' as const, flip: false };
    const position = pictures++;
    if (position % 4 === 0) {
      const flip = spreads++ % 2 === 1;
      return { slot: 'spread' as const, flip };
    }
    return { slot: 'row' as const, flip: false };
  });
}

/** "1 story" / "3 stories". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Words in a Markdown body (for an honest read-time and length fact). */
export function wordCount(markdown: string | null | undefined): number {
  const text = (markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * External sources an article links to, in order of first appearance, with
 * the host as a readable label. Only absolute http(s) links count.
 */
export function citedSources(markdown: string | null | undefined): Array<{ href: string; label: string; host: string }> {
  const seen = new Set<string>();
  const out: Array<{ href: string; label: string; host: string }> = [];
  for (const match of (markdown ?? '').matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    const href = match[2]!;
    let host: string;
    try {
      const url = new URL(href);
      if (url.username || url.password) continue;
      host = url.hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label: match[1]!.trim(), host });
  }
  return out;
}

// ─── Syndicated duplicates ─────────────────────────────────────────────────

/** A publisher that ran the same story (a syndicated copy that was folded in). */
export interface AlsoAt {
  source: string;
  href: string;
}

interface Collapsible {
  title: string;
  href: string;
  source: string;
  publishedMs: number;
  summary?: string;
  imageUrl?: string | null;
}

const SYNDICATION_WINDOW_MS = 36 * 3_600_000;
/** Slug words too common in F1 URLs to say two stories are one. */
const SLUG_STOPWORDS = new Set(['f1', 'formula', 'one', 'news', 'grand', 'prix', 'gp', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'as', 'by', 'with', 'from', 'after', 'but', 'how', 'why', 'what']);

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Significant words of the article's URL slug (the longest non-numeric path segment). */
export function slugWords(href: string): string[] {
  let segments: string[];
  try {
    segments = new URL(href).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
  const slug = segments.filter((s) => /[a-z]/i.test(s) && s.includes('-')).sort((a, b) => b.length - a.length)[0] ?? '';
  return slug
    .toLowerCase()
    .split('-')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !SLUG_STOPWORDS.has(w));
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared++;
  return shared / (left.size + right.size - shared);
}

function summaryKey(summary: string | undefined): string {
  return alnum(summary ?? '').slice(0, 140);
}

/**
 * Two wire stories from different publishers are one syndicated story when
 * they were published within 36 hours of each other and either carry the
 * same standfirst, or their URL slugs share most of their significant words
 * (Motorsport.com and Autosport publish one Motorsport Network article under
 * two headlines but keep the original slug). Same-publisher pairs are never
 * merged: a newsroom's two stories on one topic are two stories.
 */
export function isSyndicatedPair(a: Collapsible, b: Collapsible): boolean {
  const hostA = hostOf(a.href);
  const hostB = hostOf(b.href);
  if (!hostA || !hostB || hostA === hostB || a.source === b.source) return false;
  if (a.publishedMs && b.publishedMs && Math.abs(a.publishedMs - b.publishedMs) > SYNDICATION_WINDOW_MS) return false;
  const sa = summaryKey(a.summary);
  if (sa.length >= 80 && sa === summaryKey(b.summary)) return true;
  const wa = slugWords(a.href);
  const wb = slugWords(b.href);
  return wa.length >= 5 && wb.length >= 5 && jaccard(wa, wb) >= 0.7;
}

/**
 * Fold syndicated copies into one story. The story keeps the place of the
 * newest copy; the copy shown is the first one with a picture (else the
 * newest), and the other publishers are listed in `alsoAt` so nothing is
 * hidden from the reader. Order is otherwise unchanged. With `prefer`, that
 * publisher's copy is shown wherever it ran one.
 */
export function collapseSyndicated<T extends Collapsible>(stories: readonly T[], prefer?: string): Array<T & { alsoAt: AlsoAt[] }> {
  const clusters: T[][] = [];
  for (const story of stories) {
    const cluster = clusters.find((members) => members.some((m) => isSyndicatedPair(m, story)));
    if (cluster) cluster.push(story);
    else clusters.push([story]);
  }
  return clusters.map((members) => {
    // A publisher filter shows that publisher's own copy; otherwise the first copy with a picture.
    const lead = (prefer ? members.find((m) => m.source === prefer) : undefined) ?? members.find((m) => m.imageUrl) ?? members[0]!;
    const alsoAt = members.filter((m) => m !== lead).map((m) => ({ source: m.source, href: m.href }));
    return { ...lead, alsoAt };
  });
}
