import { check, jsonb, pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { article } from './article';

export const editorialAudit = pgTable('editorial_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  articleId: uuid('article_id').references(() => article.id, { onDelete: 'set null' }),
  actor: text('actor').notNull(),
  operation: text('operation', { enum: ['create', 'update', 'publication'] }).notNull(),
  previousRevision: timestamp('previous_revision', { withTimezone: true }),
  revision: timestamp('revision', { withTimezone: true }).notNull(),
  publication: jsonb('publication').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  actorCheck: check('editorial_audit_actor_check', sql`length(btrim(${t.actor})) between 1 and 64`),
  operationCheck: check('editorial_audit_operation_check', sql`${t.operation} in ('create', 'update', 'publication')`),
  articleCreatedIdx: index('editorial_audit_article_created_idx').on(t.articleId, t.createdAt.desc(), t.id.desc()),
}));
