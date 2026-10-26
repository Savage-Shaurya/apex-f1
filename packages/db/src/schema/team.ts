import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { driver } from './driver';
import { season } from './season';

export const team = pgTable(
  'team',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    fullName: text('full_name'),
    base: text('base'),
    principal: text('principal'),
    technicalChief: text('technical_chief'),
    powerUnit: text('power_unit'),
    foundedYear: integer('founded_year'),
    // Shared Team type declares colorHex as required (drives team color
    // stripes site-wide). Default to neutral grey so the column never
    // returns null at the read boundary. Worker / admin can override.
    colorHex: text('color_hex').notNull().default('#262626'),
    logoUrl: text('logo_url'),
    carImageUrl: text('car_image_url'),
    liveryImageUrl: text('livery_image_url'),
    championshipsCount: integer('championships_count').default(0),
    wikiUrl: text('wiki_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index('team_name_idx').on(t.name),
  }),
);

export const driverTeamHistory = pgTable(
  'driver_team_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => driver.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    seasonYear: integer('season_year')
      .notNull()
      .references(() => season.year),
    role: text('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    driverSeasonIdx: index('dth_driver_season_idx').on(t.driverId, t.seasonYear),
    teamSeasonIdx: index('dth_team_season_idx').on(t.teamId, t.seasonYear),
    // Unique natural key so the worker can do an idempotent upsert without
    // a SELECT-then-INSERT race. Closes audit P1 (driver_team_history
    // table is never written today).
    driverTeamSeasonUnique: uniqueIndex('dth_driver_team_season_unique').on(
      t.driverId,
      t.teamId,
      t.seasonYear,
    ),
  }),
);

export type Team = typeof team.$inferSelect;
export type NewTeam = typeof team.$inferInsert;
