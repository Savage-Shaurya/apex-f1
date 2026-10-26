import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  index,
  date,
} from 'drizzle-orm/pg-core';

export const driver = pgTable(
  'driver',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable slug (Jolpica driverId · e.g. max_verstappen). */
    slug: text('slug').notNull().unique(),
    code: text('code'),
    permanentNumber: integer('permanent_number'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    fullName: text('full_name').notNull(),
    nationality: text('nationality').notNull(),
    countryCode: text('country_code'),
    dob: date('dob'),
    debutYear: integer('debut_year'),
    retiredYear: integer('retired_year'),
    bioMd: text('bio_md'),
    headshotUrl: text('headshot_url'),
    helmetUrl: text('helmet_url'),
    profileImageUrl: text('profile_image_url'),
    wikiUrl: text('wiki_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    nameIdx: index('driver_full_name_idx').on(t.fullName),
    nationalityIdx: index('driver_nationality_idx').on(t.nationality),
  }),
);

export type Driver = typeof driver.$inferSelect;
export type NewDriver = typeof driver.$inferInsert;
