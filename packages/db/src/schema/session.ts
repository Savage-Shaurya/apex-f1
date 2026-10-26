import { pgTable, text, timestamp, uuid, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { race } from './race';

export const sessionKind = ['FP1', 'FP2', 'FP3', 'SQ', 'S', 'Q', 'R'] as const;
export const sessionStatus = ['scheduled', 'live', 'completed', 'cancelled'] as const;

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => race.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: sessionKind }).notNull(),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    actualStart: timestamp('actual_start', { withTimezone: true }),
    actualEnd: timestamp('actual_end', { withTimezone: true }),
    status: text('status', { enum: sessionStatus }).notNull().default('scheduled'),
    openf1SessionKey: text('openf1_session_key'),
    scheduleSource: text('schedule_source'),
    scheduleSourceState: text('schedule_source_state', { enum: ['active', 'unreported', 'unreviewed'] }).notNull().default('unreviewed'),
    scheduleObservationId: uuid('schedule_observation_id'),
    statusSourceUrl: text('status_source_url'),
    statusSourceObservedAt: timestamp('status_source_observed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // One canonical schedule session per kind. Revisions update this row's
    // stable ID; they must not delete video/OpenF1 references and reinsert.
    // Repeated occurrences require an explicit occurrence model, not dedup.
    raceKindUnique: uniqueIndex('session_race_kind_unique').on(t.raceId, t.kind),
    raceIdx: index('session_race_idx').on(t.raceId),
    openf1Idx: index('session_openf1_idx').on(t.openf1SessionKey),
    kindCheck: check('session_kind_check', sql`${t.kind} in ('FP1','FP2','FP3','SQ','S','Q','R')`),
    statusCheck: check('session_status_check', sql`${t.status} in ('scheduled','live','completed','cancelled')`),
    sourceStateCheck: check('session_source_state_check', sql`${t.scheduleSourceState} in ('active','unreported','unreviewed')`),
  }),
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
