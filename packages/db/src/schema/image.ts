import {
  pgTable,
  text,
  integer,
  real,
  uuid,
  timestamp,
} from 'drizzle-orm/pg-core';

export const image = pgTable('image', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  originalUrl: text('original_url').notNull(),
  width: integer('width'),
  height: integer('height'),
  altText: text('alt_text'),
  focalX: real('focal_x'),
  focalY: real('focal_y'),
  license: text('license'),
  attribution: text('attribution'),
  blurhash: text('blurhash'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Image = typeof image.$inferSelect;
export type NewImage = typeof image.$inferInsert;
