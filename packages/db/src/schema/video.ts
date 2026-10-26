import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { race } from './race';
import { session } from './session';

export const videoProvider = ['youtube', 'native', 'vimeo'] as const;

export const video = pgTable(
  'video',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    provider: text('provider', { enum: videoProvider }).notNull(),
    providerAssetId: text('provider_asset_id').notNull(),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    durationSeconds: integer('duration_seconds'),
    thumbnailUrl: text('thumbnail_url'),
    embedUrl: text('embed_url'),
    hlsUrl: text('hls_url'),
    availability: text('availability').default('public'),
    raceId: uuid('race_id').references(() => race.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => session.id, { onDelete: 'set null' }),
    channelName: text('channel_name'),
    channelHandle: text('channel_handle'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    publishedIdx: index('video_published_idx').on(t.publishedAt),
    // Unique on (provider, providerAssetId) so concurrent youtube-nightly
    // runs cannot race-double-insert and so onConflictDoUpdate has a stable
    // natural key. Closes audit P0 finding in audit-data-models-types.
    providerAssetUnique: uniqueIndex('video_provider_asset_unique').on(
      t.provider,
      t.providerAssetId,
    ),
  }),
);

export type Video = typeof video.$inferSelect;
export type NewVideo = typeof video.$inferInsert;
