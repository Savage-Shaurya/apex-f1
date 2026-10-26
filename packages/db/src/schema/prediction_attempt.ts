import { check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { race } from './race';

/** Exact request receipts survive an uncertain client response and deadline. */
export const predictionAttempt = pgTable('prediction_attempt', {
  clientId: text('client_id').notNull(),
  season: integer('season').notNull(),
  round: integer('round').notNull(),
  attemptId: uuid('attempt_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  outcome: text('outcome', { enum: ['applied', 'conflict', 'locked'] }).notNull(),
  predictionRevision: text('prediction_revision'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.clientId, t.season, t.round, t.attemptId] }),
  raceFk: foreignKey({ columns: [t.season, t.round], foreignColumns: [race.seasonYear, race.round] }).onDelete('restrict'),
  hashCheck: check('prediction_attempt_hash_check', sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`),
  contentHashCheck: check('prediction_attempt_content_hash_check', sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
  outcomeCheck: check('prediction_attempt_outcome_check', sql`${t.outcome} in ('applied','conflict','locked')`),
  createdIdx: index('prediction_attempt_created_idx').on(t.createdAt),
}));
