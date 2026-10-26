import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './client';
import { ArticleStorageUnavailable } from './queries';

export interface ArticleSitemapRange { from: string | null; until: string | null }
export interface ArticleSitemapEntry { slug: string; updatedAt: Date }
export const ARTICLE_SITEMAP_TARGET = 5_000;
export const ARTICLE_SITEMAP_MAX_URLS = 50_000;
const MAX_ARTICLE_MAPS = ARTICLE_SITEMAP_MAX_URLS - 1; // Reserve the directory map in the index.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PUBLIC = sql`published_at is not null and published_at <= now() and not is_premium
  and (embargo_until is null or embargo_until <= now())`;

/** Stable UUID intervals avoid OFFSET drift between independently fetched maps. */
export function isArticleSitemapRange(range: ArticleSitemapRange): boolean {
  return (range.from === null || UUID.test(range.from)) &&
    (range.until === null || UUID.test(range.until)) &&
    (range.from === null || range.until === null || range.from < range.until);
}
export function encodeArticleSitemapRange(range: ArticleSitemapRange): string {
  if (!isArticleSitemapRange(range)) throw new Error('Invalid article sitemap range.');
  return `${range.from ?? 'start'}.${range.until ?? 'end'}`;
}
export function decodeArticleSitemapRange(value: string): ArticleSitemapRange | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const range = { from: parts[0] === 'start' ? null : parts[0]!, until: parts[1] === 'end' ? null : parts[1]! };
  return isArticleSitemapRange(range) ? range : null;
}

/** Only identifiers and timestamps cross this seam; bodies are never loaded. */
export function createArticleSitemapRepository(execute: (statement: SQL) => Promise<Record<string, unknown>[]>) {
  async function getArticleSitemapRanges(): Promise<ArticleSitemapRange[]> {
    const anchors = await execute(sql`select id from (
      select id, row_number() over (order by id) as ordinal from article where ${PUBLIC}
    ) as public_articles where (ordinal - 1) % ${ARTICLE_SITEMAP_TARGET} = 0
      order by id limit ${MAX_ARTICLE_MAPS + 1}`);
    if (anchors.length > MAX_ARTICLE_MAPS) throw new ArticleStorageUnavailable();
    if (!anchors.length) return [];
    const ids = anchors.map((row) => String(row.id));
    if (ids.some((id) => !UUID.test(id)) || ids.some((id, index) => index > 0 && id <= ids[index - 1]!)) throw new ArticleStorageUnavailable();
    return ids.map((id, index) => ({ from: index === 0 ? null : id, until: ids[index + 1] ?? null }));
  }
  async function getArticleSitemapEntries(range: ArticleSitemapRange): Promise<ArticleSitemapEntry[]> {
    if (!isArticleSitemapRange(range)) throw new Error('Invalid article sitemap range.');
    const rows = await execute(sql`select slug, updated_at from article where ${PUBLIC}
      ${range.from ? sql`and id >= ${range.from}::uuid` : sql``}
      ${range.until ? sql`and id < ${range.until}::uuid` : sql``}
      order by id limit ${ARTICLE_SITEMAP_MAX_URLS + 1}`);
    // Fail a stale, overgrown range instead of silently publishing a truncated map.
    if (rows.length > ARTICLE_SITEMAP_MAX_URLS) throw new ArticleStorageUnavailable();
    return rows.map((row) => {
      const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at));
      if (typeof row.slug !== 'string' || !row.slug || row.slug.length > 1_000 || !Number.isFinite(updatedAt.getTime())) throw new ArticleStorageUnavailable();
      return { slug: row.slug, updatedAt };
    });
  }
  return { getArticleSitemapRanges, getArticleSitemapEntries };
}
function repository() { return createArticleSitemapRepository(async (statement) => getDb().execute(statement)); }
export async function getArticleSitemapRanges(): Promise<ArticleSitemapRange[]> {
  if (!process.env.DATABASE_URL) return [];
  try { return await repository().getArticleSitemapRanges(); } catch { throw new ArticleStorageUnavailable(); }
}
export async function getArticleSitemapEntries(range: ArticleSitemapRange): Promise<ArticleSitemapEntry[]> {
  if (!isArticleSitemapRange(range)) throw new Error('Invalid article sitemap range.');
  if (!process.env.DATABASE_URL) return [];
  try { return await repository().getArticleSitemapEntries(range); } catch { throw new ArticleStorageUnavailable(); }
}
