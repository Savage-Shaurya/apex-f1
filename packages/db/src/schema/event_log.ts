import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  bigserial,
} from 'drizzle-orm/pg-core';

export const eventLog = pgTable(
  'event_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
    userId: uuid('user_id'),
    anonymousId: text('anonymous_id'),
    name: text('name').notNull(),
    props: jsonb('props').default({}).notNull(),
  },
  (t) => ({
    tsIdx: index('event_log_ts_idx').on(t.ts),
    nameIdx: index('event_log_name_idx').on(t.name),
  }),
);

export type EventLog = typeof eventLog.$inferSelect;
export type NewEventLog = typeof eventLog.$inferInsert;
