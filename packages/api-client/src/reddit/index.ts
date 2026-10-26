import { getRssFeed, type RssItem } from '../rss';

export interface RedditPost {
  id: string;
  title: string;
  url: string;
  author?: string;
  publishedAt: string;
  publishedMs: number;
  excerpt?: string;
  thumbnailUrl?: string;
}

const REDDIT_FORMULA1_RSS = 'https://www.reddit.com/r/formula1.rss';

function commentsLink(linkOrId: string): string {
  // Reddit Atom IDs look like "t3_abc123" · we prefer the actual comments link.
  return linkOrId;
}

/** Top r/formula1 hot threads. Public RSS feed · no auth required. */
export async function getRedditFormula1Pulse(opts: {
  limit?: number;
  revalidate?: number;
} = {}): Promise<RedditPost[]> {
  const items = await getRssFeed(
    { name: 'r/formula1', url: REDDIT_FORMULA1_RSS, homepage: 'https://www.reddit.com' },
    { revalidate: opts.revalidate ?? 600 },
  );
  const limit = opts.limit ?? 8;
  return items.slice(0, limit).map((it: RssItem): RedditPost => ({
    id: it.link,
    title: it.title,
    url: commentsLink(it.link),
    author: it.author,
    publishedAt: it.pubDate,
    publishedMs: it.pubDateMs,
    excerpt: it.description,
    thumbnailUrl: it.imageUrl,
  }));
}
