import type { RssItem } from '../rss';
import type { GuardianContentItem } from './types';

/**
 * UiNewsItem is a structural alias of RssItem so Guardian results slot
 * straight into the existing aggregator pipeline without a second type.
 * We export it explicitly for callers that want a semantic name.
 */
export type UiNewsItem = RssItem;

/** Strip Guardian-emitted HTML out of trailText so the UI can render plaintext safely. */
function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function toMs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Single-item mapper. */
export function mapGuardianItem(item: GuardianContentItem): UiNewsItem {
  const fields = item.fields ?? {};
  return {
    source: 'The Guardian',
    title: stripHtml(item.webTitle),
    link: item.webUrl,
    pubDate: item.webPublicationDate,
    pubDateMs: toMs(item.webPublicationDate),
    description: stripHtml(fields.trailText),
    imageUrl: fields.thumbnail || undefined,
    author: fields.byline || undefined,
    categories: [item.sectionName].filter(Boolean),
  };
}

/** Bulk mapper. Filters out items missing title or link. */
export function mapGuardianItems(items: GuardianContentItem[]): UiNewsItem[] {
  return items.map(mapGuardianItem).filter((i) => i.title && i.link);
}
