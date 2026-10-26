import {
  pgTable,
  text,
  uuid,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const user = pgTable('app_user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  oauthProvider: text('oauth_provider'),
  locale: text('locale').default('en'),
  timezone: text('timezone'),
  apexPlusUntil: timestamp('apex_plus_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const follow = pgTable(
  'follow',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityKind: text('entity_kind', { enum: ['driver', 'team', 'race', 'tag'] }).notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.entityKind, t.entityId] }),
    entityIdx: index('follow_entity_idx').on(t.entityKind, t.entityId),
  }),
);

export const saved = pgTable(
  'saved',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contentKind: text('content_kind', { enum: ['article', 'video'] }).notNull(),
    contentId: uuid('content_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.contentKind, t.contentId] }) }),
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
