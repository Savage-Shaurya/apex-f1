import { pgTable, integer, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const seasonStatus = ['completed', 'active', 'upcoming'] as const;

export const season = pgTable('season', {
  year: integer('year').primaryKey(),
  status: text('status', { enum: seasonStatus }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Season = typeof season.$inferSelect;
export type NewSeason = typeof season.$inferInsert;
