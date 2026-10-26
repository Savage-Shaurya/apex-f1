import {
  pgTable,
  integer,
  real,
  uuid,
  index,
  uniqueIndex,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';
import { driver } from './driver';
import { team } from './team';
import { season } from './season';

export const standingDriver = pgTable(
  'standing_driver',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull().default('legacy-unreviewed'),
    seasonYear: integer('season_year')
      .notNull()
      .references(() => season.year, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driver.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    points: real('points').notNull(),
    wins: integer('wins').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    seasonRoundDriverUnique: uniqueIndex('sd_unique').on(
      t.seasonYear,
      t.round,
      t.driverId,
    ),
    seasonRoundIdx: index('sd_season_round_idx').on(t.seasonYear, t.round),
  }),
);

export const standingTeam = pgTable(
  'standing_team',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull().default('legacy-unreviewed'),
    seasonYear: integer('season_year')
      .notNull()
      .references(() => season.year, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    position: integer('position').notNull(),
    points: real('points').notNull(),
    wins: integer('wins').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    seasonRoundTeamUnique: uniqueIndex('st_unique').on(
      t.seasonYear,
      t.round,
      t.teamId,
    ),
    seasonRoundIdx: index('st_season_round_idx').on(t.seasonYear, t.round),
  }),
);

export type StandingDriver = typeof standingDriver.$inferSelect;
export type StandingTeam = typeof standingTeam.$inferSelect;
