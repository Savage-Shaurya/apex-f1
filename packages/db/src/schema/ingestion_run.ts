import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  jsonb,
} from 'drizzle-orm/pg-core';

export const ingestionRunStatus = ['running', 'success', 'failed'] as const;

export const ingestionRun = pgTable('ingestion_run', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: text('status', { enum: ingestionRunStatus }).notNull().default('running'),
  itemsIn: integer('items_in').default(0),
  itemsOut: integer('items_out').default(0),
  error: text('error'),
  details: jsonb('details').default({}),
});

export type IngestionRun = typeof ingestionRun.$inferSelect;
export type NewIngestionRun = typeof ingestionRun.$inferInsert;
