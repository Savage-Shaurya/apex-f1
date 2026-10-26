import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from './client';
import { article } from './schema';

export interface ApexArticleSummary {
  slug: string;
  title: string;
  dek: string | null;
  excerpt: string | null;
  section: string | null;
  heroImageUrl: string | null;
  readTimeMinutes: number | null;
  publishedAt: Date | null;
  updatedAt?: Date;
}
export interface ApexArticle extends ApexArticleSummary { bodyMd: string | null }

const SUMMARY_COLS = {
  slug: article.slug,
  title: article.title,
  dek: article.dek,
  excerpt: article.excerpt,
  section: article.section,
  heroImageUrl: article.heroImageUrl,
  readTimeMinutes: article.readTimeMinutes,
  publishedAt: article.publishedAt,
  updatedAt: article.updatedAt,
} as const;
const DETAIL_COLS = { ...SUMMARY_COLS, bodyMd: article.bodyMd } as const;

const publiclyPublished = () => and(isNotNull(article.publishedAt), eq(article.isPremium, false), sql`${article.publishedAt} <= now()`, sql`(${article.embargoUntil} is null or ${article.embargoUntil} <= now())`);
export class ArticleStorageUnavailable extends Error {
  constructor() {
    super('Apex Originals are temporarily unavailable. Please try again shortly.');
    this.name = 'ArticleStorageUnavailable';
  }
}

/**
 * Latest published Apex original editorial, newest first. Returns [] when the DB
 * is unset. A configured store failure is distinct from an empty publication
 * list, so callers can show an unavailable state alongside the wire feed.
 */
export async function getPublishedArticles(limit = 6): Promise<ApexArticleSummary[]> {
  if (!process.env['DATABASE_URL']) return [];
  try {
    const db = getDb();
    return await db
      .select(SUMMARY_COLS)
      .from(article)
      .where(publiclyPublished())
      .orderBy(desc(article.publishedAt))
      .limit(Math.max(1, Math.min(2000, Math.trunc(limit) || 6)));
  } catch {
    throw new ArticleStorageUnavailable();
  }
}

/** A single published article by slug, or null. */
export async function getArticleBySlug(slug: string): Promise<ApexArticle | null> {
  if (!process.env['DATABASE_URL']) return null;
  try {
    const db = getDb();
    const rows = await db
      .select(DETAIL_COLS)
      .from(article)
      .where(and(eq(article.slug, slug), publiclyPublished()))
      .limit(1);
    return rows[0] ?? null;
  } catch {
    throw new ArticleStorageUnavailable();
  }
}
