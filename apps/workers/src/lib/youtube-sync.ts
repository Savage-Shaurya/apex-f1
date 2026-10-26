import {
  getChannelStats,
  getPlaylistItems,
  getVideoDetails,
  YT_F1_CHANNELS,
  type YTChannelStats,
  type YTPlaylistItem,
  type YTVideoDetail,
  type YouTubeFetchOpts,
} from "@apex/api-client/youtube";
function safeErrorMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) if (value && /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|SERVICE_ROLE/i.test(key)) text = text.split(value).join('[redacted]');
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL]').replace(/\b(?:https?|rediss?):\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, '[credential URL]').replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]').slice(0, 500);
}

export interface YouTubeSyncDependencies {
  channels: typeof YT_F1_CHANNELS;
  channelStats(
    ids: string[],
    opts: YouTubeFetchOpts,
  ): Promise<YTChannelStats[]>;
  playlistItems(
    id: string,
    limit: number,
    opts: YouTubeFetchOpts,
  ): Promise<YTPlaylistItem[]>;
  videoDetails(ids: string[], opts: YouTubeFetchOpts): Promise<YTVideoDetail[]>;
  persist(videos: YTVideoDetail[]): Promise<number>;
  begin?(): Promise<void>;
  verifyStored?(excludeVideoIds: string[]): Promise<{ videoIds: string[]; nextAfterVideoId: string | null }>;
  reconcile?(input: { requestedVideoIds: string[]; publicVideos: YTVideoDetail[]; unavailableVideoIds: string[]; verificationCursor?: string | null }): Promise<{ persisted: number; unavailable: number }>;
  signal?: AbortSignal;
}

export const youtubeSyncReaders = {
  channels: YT_F1_CHANNELS,
  channelStats: getChannelStats,
  playlistItems: getPlaylistItems,
  videoDetails: getVideoDetails,
};

/** Bounded recent discovery plus durable rotating re-verification of known IDs.
 * Only successful exact-ID detail reads can change their stored availability.
 */
export async function syncRecentYouTubeUploads(deps: YouTubeSyncDependencies) {
  const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(deps.signal ? [deps.signal] : [])]);
  const opts: YouTubeFetchOpts = { strict: true, signal, revalidate: 0 };
  const errors: string[] = [];
  signal.throwIfAborted();
  await deps.begin?.();
  signal.throwIfAborted();
  let unitsAttemptedEstimate = 1;
  let stats: YTChannelStats[] = [];
  try {
    stats = await deps.channelStats(
      deps.channels.map((channel) => channel.channelId),
      opts,
    );
    const configured = new Set(deps.channels.map((channel) => channel.channelId));
    if (stats.some((channel) => !configured.has(channel.channelId)) || new Set(stats.map((channel) => channel.channelId)).size !== stats.length) throw new Error('Channel metadata identity differs from configured channels.');
  } catch (error) {
    stats = [];
    errors.push(`channel metadata: ${safeErrorMessage(error)}`);
  }
  const byId = new Map(stats.map((channel) => [channel.channelId, channel]));
  const channels: Array<{
    channelId: string;
    name: string;
    uploadsChecked: number;
    videoIds?: string[];
    error?: string;
  }> = await Promise.all(
    deps.channels.map(async (channel) => {
      const playlistId = byId.get(channel.channelId)?.uploadsPlaylistId;
      if (!playlistId)
        return {
          ...channel,
          uploadsChecked: 0,
          error: "Uploads playlist unavailable for this configured channel.",
        };
      unitsAttemptedEstimate++;
      try {
        const items = await deps.playlistItems(playlistId, 50, opts);
        return {
          ...channel,
          uploadsChecked: items.length,
          videoIds: items.map((item) => item.videoId),
        };
      } catch (error) {
        return {
          ...channel,
          uploadsChecked: 0,
          error: safeErrorMessage(error),
        };
      }
    }),
  );
  const recentIds = [
    ...new Set(channels.flatMap((channel) => channel.videoIds ?? [])),
  ];
  if (recentIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))) throw new Error('Invalid upload video identity.');
  let verification: { videoIds: string[]; nextAfterVideoId: string | null } | undefined;
  try {
    verification = await deps.verifyStored?.(recentIds);
    if (verification && (verification.videoIds.length > 100 || verification.videoIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)))) throw new Error('Invalid stored verification identities.');
  } catch (error) { errors.push(`stored verification: ${safeErrorMessage(error)}`); }
  const ids = [...new Set([...recentIds, ...(verification?.videoIds ?? [])])];
  if (ids.length > 500) throw new Error('Video details exceeded the bounded collection size.');
  let videos: YTVideoDetail[] = [];
  let detailsComplete = ids.length === 0;
  if (ids.length) {
    unitsAttemptedEstimate += Math.ceil(ids.length / 50);
    try {
      videos = await deps.videoDetails(ids, opts);
      const allowed = new Set(
        deps.channels.map((channel) => channel.channelId),
      );
      if (
        videos.some(
          (video) =>
            !ids.includes(video.videoId) || !allowed.has(video.channelId) || !['public', 'private', 'unlisted'].includes(video.privacyStatus),
        ) ||
        new Set(videos.map((video) => video.videoId)).size !== videos.length
      )
        throw new Error(
          "Video detail identity differs from the requested uploads.",
        );
      detailsComplete = true;
    } catch (error) {
      videos = [];
      errors.push(`video details: ${safeErrorMessage(error)}`);
    }
  }
  // Removed/private uploads may be absent from videos.list; never fabricate their details.
  const publicVideos = videos.filter(
    (video) => video.privacyStatus === "public",
  ).map((video) => ({ ...video, channelName: video.channelTitle }));
  let videosPersisted = 0;
  let videosMarkedUnavailable = 0;
  if (detailsComplete && deps.reconcile) {
    try {
      signal.throwIfAborted();
      const publicIds = new Set(publicVideos.map((video) => video.videoId));
      const result = await deps.reconcile({ requestedVideoIds: ids, publicVideos, unavailableVideoIds: ids.filter((id) => !publicIds.has(id)), ...(verification ? { verificationCursor: verification.nextAfterVideoId } : {}) });
      videosPersisted = result.persisted; videosMarkedUnavailable = result.unavailable;
      if (videosPersisted !== publicVideos.length) throw new Error('Video persistence did not confirm every public video.');
    } catch (error) { errors.push(`persistence: ${safeErrorMessage(error)}`); }
  } else if (detailsComplete && publicVideos.length) {
    try {
      videosPersisted = await deps.persist(publicVideos);
      if (videosPersisted !== publicVideos.length)
        throw new Error(
          "Video persistence did not confirm every public video.",
        );
    } catch (error) {
      errors.push(`persistence: ${safeErrorMessage(error)}`);
    }
  }
  const channelErrors = channels.filter((channel) => channel.error);
  return {
    ok: errors.length === 0 && channelErrors.length === 0,
    errors,
    channels: channels.map(({ channelId, name, uploadsChecked, error }) => ({
      channelId,
      name,
      uploadsChecked,
      ...(error ? { error } : {}),
    })),
    totals: {
      quotaUnitsAttemptedEstimate: unitsAttemptedEstimate,
      // Estimate counts attempted reads; actual project allocation/usage lives in Cloud Console.
      searchCallsAttempted: 0,
      recentUploadsLimitPerChannel: 50,
      videosFetched: ids.length,
      videosEnriched: videos.length,
      videosRemovedOrUnavailable: ids.length - videos.length,
      videosNonPublic: videos.length - publicVideos.length,
      videosPersisted,
      storedVideoIdsRechecked: verification?.videoIds.length ?? 0,
      videosMarkedUnavailable,
    },
  };
}
