import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';

export const author = pgTable('author', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  bioMd: text('bio_md'),
  avatarUrl: text('avatar_url'),
  twitter: text('twitter'),
  instagram: text('instagram'),
  email: text('email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Author = typeof author.$inferSelect;
export type NewAuthor = typeof author.$inferInsert;
