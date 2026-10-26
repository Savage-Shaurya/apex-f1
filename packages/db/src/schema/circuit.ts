import { pgTable, text, real, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const circuit = pgTable('circuit', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  country: text('country').notNull(),
  city: text('city'),
  lat: real('lat'),
  lon: real('lon'),
  lengthKm: real('length_km'),
  corners: integer('corners'),
  lapRecordMs: integer('lap_record_ms'),
  lapRecordHolder: text('lap_record_holder'),
  lapRecordYear: integer('lap_record_year'),
  svgPath: text('svg_path'),
  imageUrl: text('image_url'),
  wikiUrl: text('wiki_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Circuit = typeof circuit.$inferSelect;
export type NewCircuit = typeof circuit.$inferInsert;
