import type { RssItem } from '../rss';
import type { CurrentsNewsItem } from './types';

export type UiNewsItem = RssItem;

function toMs(s: string | undefined): number {
  if (!s) return 0;
  // Currents emits "2026-06-21 18:45:00 +0000" which Date parses but with quirks
  // on some engines. Normalize to ISO before parsing.
  const iso = s.replace(' ', 'T').replace(' +', '+').replace(' -', '-');
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function mapCurrentsItem(item: CurrentsNewsItem): UiNewsItem {
  return {
    source: 'Currents',
    title: item.title,
    link: item.url,
    pubDate: item.published,
    pubDateMs: toMs(item.published),
    description: item.description || undefined,
    imageUrl: item.image && item.image !== 'None' ? item.image : undefined,
    author: item.author || undefined,
    categories: Array.isArray(item.category) ? item.category : undefined,
  };
}

export function mapCurrentsItems(items: CurrentsNewsItem[]): UiNewsItem[] {
  return items.map(mapCurrentsItem).filter((i) => i.title && i.link);
}
