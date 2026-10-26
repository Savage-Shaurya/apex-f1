import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  index,
  primaryKey,
  integer,
} from 'drizzle-orm/pg-core';
import { author } from './author';
import { tag } from './tag';
import { driver } from './driver';
import { team } from './team';
import { race } from './race';
import { sql } from 'drizzle-orm';

export const articleType = [
  'news',
  'feature',
  'analysis',
  'quiz',
  'guide',
  'press',
  'gallery',
  'newsletter',
] as const;

export const article = pgTable(
  'article',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    dek: text('dek'),
    bodyMd: text('body_md'),
    excerpt: text('excerpt'),
    type: text('type', { enum: articleType }).notNull().default('news'),
    section: text('section'),
    authorId: uuid('author_id').references(() => author.id, { onDelete: 'set null' }),
    heroImageUrl: text('hero_image_url'),
    thumbnailUrl: text('thumbnail_url'),
    ogImageUrl: text('og_image_url'),
    readTimeMinutes: integer('read_time_minutes'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    embargoUntil: timestamp('embargo_until', { withTimezone: true }),
    isBreaking: boolean('is_breaking').default(false).notNull(),
    isPinned: boolean('is_pinned').default(false).notNull(),
    isPremium: boolean('is_premium').default(false).notNull(),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publishedAtIdx: index('article_published_at_idx').on(t.publishedAt),
    revisionCursorIdx: index('article_revision_cursor_idx').on(t.updatedAt.desc(), t.id.desc()),
    publicIdIdx: index('article_public_id_idx').on(t.id).where(sql`${t.publishedAt} IS NOT NULL AND NOT ${t.isPremium}`),
    typeIdx: index('article_type_idx').on(t.type),
  }),
);

export const articleTag = pgTable(
  'article_tag',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tag.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.articleId, t.tagId] }) }),
);

export const articleDriver = pgTable(
  'article_driver',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driver.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.articleId, t.driverId] }) }),
);

export const articleTeam = pgTable(
  'article_team',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.articleId, t.teamId] }) }),
);

export const articleRace = pgTable(
  'article_race',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => article.id, { onDelete: 'cascade' }),
    raceId: uuid('race_id')
      .notNull()
      .references(() => race.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.articleId, t.raceId] }) }),
);

export type Article = typeof article.$inferSelect;
export type NewArticle = typeof article.$inferInsert;
