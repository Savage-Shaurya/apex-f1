import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';

export const tagKind = ['topic', 'driver', 'team', 'race', 'season', 'circuit'] as const;

export const tag = pgTable(
  'tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    label: text('label').notNull(),
    kind: text('kind', { enum: tagKind }).notNull().default('topic'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    kindIdx: index('tag_kind_idx').on(t.kind),
  }),
);

export type Tag = typeof tag.$inferSelect;
export type NewTag = typeof tag.$inferInsert;
