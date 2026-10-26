import { bigint, check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Orders local fetch attempts. A generation is not a publisher revision. */
export const sourceSnapshot = pgTable('source_snapshot', {
  source: text('source').notNull(),
  scope: text('scope').notNull(),
  generation: bigint('generation', { mode: 'bigint' }).notNull().default(sql`1`),
  observationId: uuid('observation_id').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  appliedObservationId: uuid('applied_observation_id'),
  contentHash: text('content_hash'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => ({
  pk: primaryKey({ columns: [t.source, t.scope] }),
  generationCheck: check('source_snapshot_generation_check', sql`${t.generation} > 0`),
}));

/** Redacted reconciliation audit; no private user picks or provider secrets. */
export const sourceSnapshotEvent = pgTable('source_snapshot_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  scope: text('scope').notNull(),
  generation: bigint('generation', { mode: 'bigint' }).notNull(),
  observationId: uuid('observation_id').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
});
