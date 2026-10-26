import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { getDb, getWorkerDb } from './client';
import { boundedTransaction } from './bounded-transaction';
import { video } from './schema/video';
import { completeSourceObservation, withSourceObservation, type DbTransaction, type SourceObservation } from './source-observation';

export interface PersistVideoInput {
  videoId: string; title: string; durationSeconds?: number | null; thumbnailUrl?: string | null;
  channelName?: string | null; publishedAt?: string | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_SNAPSHOT_IDS = 1000;

function configuredDb() {
  if (!process.env.DATABASE_URL) throw new Error('Video persistence is not configured.');
  return getWorkerDb();
}
function validateIds(ids: string[], maximum = MAX_SNAPSHOT_IDS): void {
  if (!Array.isArray(ids) || ids.length > maximum || ids.some((id) => typeof id !== 'string' || !VIDEO_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid or duplicate video identities.');
  }
}
function normalizedVideos(rows: PersistVideoInput[]): PersistVideoInput[] {
  if (!Array.isArray(rows) || rows.length > MAX_SNAPSHOT_IDS) throw new Error('Invalid video batch.');
  const unique = new Map<string, PersistVideoInput>();
  for (const row of rows) {
    if (!VIDEO_ID.test(row.videoId) || typeof row.title !== 'string' || !row.title.trim()) throw new Error('Invalid video identity or title.');
    if (row.publishedAt != null && (typeof row.publishedAt !== 'string' || !Number.isFinite(Date.parse(row.publishedAt)))) throw new Error('Invalid video publication timestamp.');
    if (row.durationSeconds != null && (!Number.isInteger(row.durationSeconds) || row.durationSeconds < 0 || row.durationSeconds > 2_147_483_647)) throw new Error('Invalid video duration.');
    unique.set(row.videoId, { ...row });
  }
  return [...unique.values()];
}
async function upsertVideos(tx: DbTransaction, rows: PersistVideoInput[], verifiedPublic = false): Promise<number> {
  const values = rows.map((v) => ({ slug: `yt-${v.videoId}`, provider: 'youtube' as const, providerAssetId: v.videoId, title: v.title, durationSeconds: v.durationSeconds ?? null, thumbnailUrl: v.thumbnailUrl ?? null, embedUrl: `https://www.youtube.com/embed/${v.videoId}`, channelName: v.channelName ?? null, publishedAt: v.publishedAt ? new Date(v.publishedAt) : null, availability: 'public' }));
  for (let start = 0; start < values.length; start += 500) {
    await tx.insert(video).values(values.slice(start, start + 500)).onConflictDoUpdate({
      target: [video.provider, video.providerAssetId],
      // Preserve established editorial slugs, descriptions and race/session links.
      set: { title: sql`excluded.title`, durationSeconds: sql`coalesce(excluded.duration_seconds, video.duration_seconds)`, thumbnailUrl: sql`coalesce(excluded.thumbnail_url, video.thumbnail_url)`, channelName: sql`coalesce(excluded.channel_name, video.channel_name)`, publishedAt: sql`coalesce(excluded.published_at, video.published_at)`, embedUrl: sql`excluded.embed_url`, ...(verifiedPublic ? { availability: 'public' } : {}) },
    });
  }
  return values.length;
}

/** Upsert-only compatibility path. Provider snapshot jobs use the fenced API. */
export async function persistVideos(rows: PersistVideoInput[]): Promise<number> {
  if (!process.env.DATABASE_URL) throw new Error('Video persistence is not configured.');
  const unique = normalizedVideos(rows);
  if (!unique.length) return 0;
  try { return await boundedTransaction(configuredDb(), (tx) => upsertVideos(tx, unique)); }
  catch (cause) { throw new Error('Failed to persist videos.', { cause }); }
}

export interface VideoDetailsSnapshot {
  observation: SourceObservation;
  /** IDs actually sent to completely successful, validated videos.list reads. */
  requestedVideoIds: string[];
  publicVideos: PersistVideoInput[];
  /** Explicit requested IDs absent or confirmed nonpublic in those reads. */
  unavailableVideoIds: string[];
  /** Advance rotation only together with the complete accepted snapshot. */
  verificationCursor?: string | null;
}

/** No old lookback purge: only explicitly verified IDs can become unavailable. */
export async function persistVideoDetailsSnapshot(input: VideoDetailsSnapshot): Promise<{ persisted: number; unavailable: number }> {
  configuredDb();
  if (input.observation.source !== 'youtube' || input.observation.scope !== 'details') throw new Error('Invalid video observation scope.');
  const observation = { ...input.observation, ...(input.observation.jobLease ? { jobLease: { ...input.observation.jobLease } } : {}) };
  validateIds(input.requestedVideoIds);
  validateIds(input.unavailableVideoIds);
  const unavailableVideoIds = [...input.unavailableVideoIds];
  const verificationCursor = input.verificationCursor;
  const rows = normalizedVideos(input.publicVideos);
  if (rows.length !== input.publicVideos.length) throw new Error('Duplicate public video identities.');
  const requested = new Set(input.requestedVideoIds);
  const accounted = [...rows.map((row) => row.videoId), ...unavailableVideoIds];
  if (accounted.length !== requested.size || new Set(accounted).size !== accounted.length || accounted.some((id) => !requested.has(id))) {
    throw new Error('Video details snapshot must account for every explicitly requested identity.');
  }
  if (verificationCursor !== undefined && verificationCursor !== null && (typeof verificationCursor !== 'string' || !VIDEO_ID.test(verificationCursor))) throw new Error('Invalid video verification cursor.');
  if (verificationCursor && !requested.has(verificationCursor)) throw new Error('Video verification cursor was not part of this completed snapshot.');
  const contentHash = createHash('sha256').update(JSON.stringify({
    publicVideos: [...rows].sort((a, b) => a.videoId.localeCompare(b.videoId)),
    unavailableVideoIds: [...unavailableVideoIds].sort(),
  })).digest('hex');
  return withSourceObservation(observation, async (tx) => {
    const persisted = await upsertVideos(tx, rows, true);
    let unavailable = 0;
    if (unavailableVideoIds.length) {
      const hidden = await tx.update(video).set({ availability: 'unavailable' })
        .where(and(eq(video.provider, 'youtube'), inArray(video.providerAssetId, unavailableVideoIds)))
        .returning({ id: video.id });
      unavailable = hidden.length;
    }
    await completeSourceObservation(tx, observation, contentHash, {
      requested: requested.size, public: persisted, unavailable,
      ...(verificationCursor !== undefined ? { verificationAfterVideoId: verificationCursor } : {}),
    });
    return { persisted, unavailable };
  });
}

/** Rotate through stored identities without treating playlist age as deletion. */
export async function getYoutubeVideoIdsForVerification(input: { afterVideoId?: string | null; excludeVideoIds?: string[]; limit?: number } = {}): Promise<{ videoIds: string[]; nextAfterVideoId: string | null }> {
  const db = configuredDb();
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid video verification limit.');
  const excluded = [...(input.excludeVideoIds ?? [])];
  validateIds(excluded);
  let after = input.afterVideoId;
  if (after === undefined) {
    const rows = await db.execute(sql`select details->>'verificationAfterVideoId' as "afterVideoId" from source_snapshot where source = 'youtube' and scope = 'details' limit 1`);
    after = (rows[0]?.afterVideoId as string | null | undefined) ?? null;
  }
  if (after !== null && (typeof after !== 'string' || !VIDEO_ID.test(after))) throw new Error('Invalid stored video verification cursor.');
  const select = (cursor: string | null) => db.select({ videoId: video.providerAssetId }).from(video)
    .where(and(eq(video.provider, 'youtube'), cursor ? gt(video.providerAssetId, cursor) : undefined, excluded.length ? notInArray(video.providerAssetId, excluded) : undefined))
    .orderBy(asc(video.providerAssetId)).limit(limit);
  let rows = await select(after);
  if (!rows.length && after) rows = await select(null);
  const videoIds = rows.map((row) => row.videoId);
  validateIds(videoIds, 100);
  return { videoIds, nextAfterVideoId: rows.length === limit ? rows[rows.length - 1]!.videoId : null };
}

export interface StoredVideo {
  videoId: string; title: string; thumbnailUrl: string | null; channelName: string | null;
  publishedAt: string; durationSeconds: number | null;
}

/**
 * The last verified YouTube snapshot (youtube-sync / youtube-nightly), newest
 * first. Read with the web runtime role, whose RLS policy exposes only public
 * videos; the explicit filter keeps the same answer for any role. This is the
 * fallback source for /video when the YouTube Data API and channel RSS both
 * fail (BE-7): real videos, labelled by the caller as a saved copy.
 */
export async function listStoredPublicVideos(input: { limit?: number; channelNames?: string[] } = {}): Promise<StoredVideo[]> {
  if (!process.env.DATABASE_URL) throw new Error('Video persistence is not configured.');
  const limit = input.limit ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid stored video limit.');
  const channels = [...new Set(input.channelNames ?? [])];
  if (channels.length > 50 || channels.some((name) => typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('Invalid stored video channel filter.');
  const rows = await getDb().select({
    videoId: video.providerAssetId, title: video.title, thumbnailUrl: video.thumbnailUrl,
    channelName: video.channelName, publishedAt: video.publishedAt, durationSeconds: video.durationSeconds,
  }).from(video)
    .where(and(eq(video.provider, 'youtube'), eq(video.availability, 'public'), isNotNull(video.publishedAt), channels.length ? inArray(video.channelName, channels) : undefined))
    .orderBy(desc(video.publishedAt)).limit(limit);
  return rows.flatMap((row) => VIDEO_ID.test(row.videoId) && row.publishedAt
    ? [{ videoId: row.videoId, title: row.title, thumbnailUrl: row.thumbnailUrl, channelName: row.channelName, publishedAt: row.publishedAt.toISOString(), durationSeconds: row.durationSeconds }]
    : []);
}
