import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** One row per durable scheduler key; the token fences a particular owner. */
export const jobLease = pgTable('job_lease', {
  key: text('key').primaryKey(),
  token: uuid('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type JobLeaseRow = typeof jobLease.$inferSelect;
