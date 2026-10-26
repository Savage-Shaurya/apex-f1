import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { UiRace } from "@apex/api-client/jolpica";
import type { YTChannelStats, YTVideoDetail } from "@apex/api-client/youtube";
import { JolpicaRequestControl } from "../../../packages/api-client/src/jolpica/request-control";
import { persistRaceCalendar } from "../lib/race-calendar-sync";
import {
  syncRecentYouTubeUploads,
  type YouTubeSyncDependencies,
} from "../lib/youtube-sync";
import { handleYouTubeSync } from "../lib/youtube-cron";

const originals = {
  CRON_SECRET: process.env.CRON_SECRET,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
};
afterEach(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function calendarRace(round: number): UiRace {
  return {
    season: 2026,
    round,
    slug: `venue-${round}`,
    circuitId: `venue-${round}`,
    name: `Race ${round}`,
    country: "Test",
    city: "Test",
    circuitName: "Test Circuit",
    date: "2026-10-18",
    raceStartIso: "2026-10-18T12:00:00Z",
    wikiUrl: "https://example.test/race",
    circuitWikiUrl: "https://example.test/circuit",
    lat: 1,
    lon: 2,
    sessions: [
      { kind: "Q", iso: "2026-10-17T12:00:00Z" },
      { kind: "R", iso: "2026-10-18T12:00:00Z" },
    ],
  };
}

test("calendar rejects invalid season, duplicate rounds and excessive snapshot before any write", async () => {
  let writes = 0;
  const operations = {
    expiresAt: Infinity,
    persist: async () => {
      writes++;
      return { raceId: "synthetic" };
    },
  };
  for (const races of [
    [],
    [calendarRace(1), calendarRace(1)],
    [{ ...calendarRace(1), season: 2025 }],
    Array.from({ length: 31 }, (_, i) => calendarRace(i + 1)),
  ])
    await assert.rejects(
      persistRaceCalendar(races, 2026, operations),
      /calendar is incomplete/,
    );
  assert.equal(writes, 0);
});

test("calendar preserves both source URLs, stable rounds and date-only session uncertainty", async () => {
  const races = [calendarRace(2), calendarRace(1)];
  races[0]!.slug = races[1]!.slug; // Repeated venues are legitimate; round is canonical identity.
  races[0]!.sessions[0]!.iso = "2026-10-17";
  const written: UiRace[] = [];
  const result = await persistRaceCalendar(races, 2026, {
    expiresAt: Infinity,
    persist: async (race) => {
      written.push(race);
      return { raceId: `synthetic-${race.round}` };
    },
  });
  assert.deepEqual(
    written.map((race) => race.round),
    [1, 2],
  );
  assert.equal(written[0]?.wikiUrl, "https://example.test/race");
  assert.equal(written[0]?.circuitWikiUrl, "https://example.test/circuit");
  assert.equal(written[1]?.sessions[0]?.iso, "2026-10-17");
  assert.deepEqual(result, { racesPersisted: 2, sessionsScheduled: 3 });
});

test("calendar stops before starting more writes at budget and exposes actual progress", async () => {
  let clock = 0;
  const progress: number[] = [];
  await assert.rejects(
    persistRaceCalendar([calendarRace(1), calendarRace(2)], 2026, {
      expiresAt: 10,
      now: () => clock,
      persist: async () => {
        clock = 11;
        return { raceId: "synthetic" };
      },
      onProgress: (result) => {
        progress.push(result.racesPersisted);
      },
    }),
    /exhausted after 1\/2 races/,
  );
  assert.deepEqual(progress, [1]);
});

test("local season invalidation expires matching cached entries and preserves pacing and other entries", async () => {
  let clock = 0;
  let reads = 0;
  const starts: number[] = [];
  const control = new JolpicaRequestControl({
    now: () => clock,
    sleep: async (delay) => {
      clock += delay;
    },
  });
  const read = (key: string) =>
    control.readThrough(key, 3600, { timeoutMs: 1000 }, async () => {
      starts.push(clock);
      return { version: ++reads };
    });
  assert.deepEqual(await read("season:2026"), { version: 1 });
  assert.deepEqual(await read("season:2025"), { version: 2 });
  control.invalidate((key) => key === "season:2026");
  assert.deepEqual(await read("season:2025"), { version: 2 });
  assert.deepEqual(await read("season:2026"), { version: 3 });
  assert.equal(starts.length, 3);
  assert.ok(starts[2]! - starts[1]! >= 260);
});

test("in-flight snapshots started before invalidation cannot repopulate the local cache", async () => {
  const control = new JolpicaRequestControl();
  let release!: (value: { version: number }) => void;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const first = control.readThrough("current", 3600, {}, async () => {
    began();
    return new Promise<{ version: number }>((resolve) => {
      release = resolve;
    });
  });
  await started;
  control.invalidate(() => true);
  release({ version: 1 });
  assert.deepEqual(await first, { version: 1 });
  await Promise.resolve();
  assert.deepEqual(
    await control.readThrough("current", 3600, {}, async () => ({
      version: 2,
    })),
    { version: 2 },
  );
});

const channels = [
  { channelId: "UCsynthetic1", name: "Synthetic One" },
  { channelId: "UCsynthetic2", name: "Synthetic Two" },
];
function channelStats(): YTChannelStats[] {
  return channels.map((channel) => ({
    ...channel,
    title: channel.name,
    description: "",
    thumbnailUrl: "",
    subscriberCount: null,
    videoCount: null,
    viewCount: null,
    uploadsPlaylistId: `UU${channel.channelId}`,
  }));
}
function video(
  id = "abcdefghijk",
  channelId = channels[0]!.channelId,
): YTVideoDetail {
  return {
    videoId: id,
    channelId,
    title: "Real fixture shape",
    description: "",
    channelTitle: "Synthetic",
    publishedAt: "2026-09-20T12:00:00Z",
    thumbnailUrl: "",
    durationSeconds: 10,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    tags: [],
    categoryId: "17",
    embeddable: true,
    privacyStatus: "public",
    regionBlocked: false,
  };
}
function syncFixture(
  overrides: Partial<YouTubeSyncDependencies> = {},
): YouTubeSyncDependencies {
  return {
    channels,
    channelStats: async () => channelStats(),
    playlistItems: async () => [],
    videoDetails: async () => [],
    persist: async (rows) => rows.length,
    ...overrides,
  };
}

test("video sync recovers older recent uploads without search and persists only supplied public details", async () => {
  const written: YTVideoDetail[] = [];
  const result = await syncRecentYouTubeUploads(
    syncFixture({
      playlistItems: async (id, limit, opts) => {
        assert.equal(limit, 50);
        assert.equal(opts.strict, true);
        assert.ok(opts.signal);
        return [
          {
            videoId: id.endsWith("1") ? "abcdefghijk" : "lmnopqrstuv",
            title: "Fixture",
            description: "",
            channelTitle: "",
            publishedAt: "2026-09-20T12:00:00Z",
            thumbnailUrl: "",
            position: 0,
          },
        ];
      },
      videoDetails: async (ids) => [
        video(ids[0]),
        { ...video(ids[1], channels[1]!.channelId), privacyStatus: "private" },
      ],
      persist: async (rows) => {
        written.push(...rows);
        return rows.length;
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.totals.searchCallsAttempted, 0);
  assert.equal(result.totals.quotaUnitsAttemptedEstimate, 4);
  assert.equal(result.totals.videosNonPublic, 1);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.publishedAt, "2026-09-20T12:00:00Z");
});

test("video sync treats missing channel metadata and rejected playlists as failures", async () => {
  const missing = await syncRecentYouTubeUploads(
    syncFixture({ channelStats: async () => [] }),
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.channels.filter((channel) => channel.error).length, 2);
  const rejected = await syncRecentYouTubeUploads(
    syncFixture({
      playlistItems: async () => {
        throw new Error("synthetic unavailable");
      },
    }),
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.totals.videosPersisted, 0);
});

test("video sync rejects unexpected detail identities and partial persistence confirmations", async () => {
  const playlistItems: YouTubeSyncDependencies["playlistItems"] = async () => [
    {
      videoId: "abcdefghijk",
      title: "",
      description: "",
      channelTitle: "",
      publishedAt: "",
      thumbnailUrl: "",
      position: 0,
    },
  ];
  const unexpected = await syncRecentYouTubeUploads(
    syncFixture({
      playlistItems,
      videoDetails: async () => [video("unexpected1")],
      persist: async () => assert.fail("untrusted identity must not persist"),
    }),
  );
  assert.equal(unexpected.ok, false);
  assert.match(unexpected.errors.join(";"), /identity differs/);
  const partial = await syncRecentYouTubeUploads(
    syncFixture({
      playlistItems,
      videoDetails: async () => [video()],
      persist: async () => 0,
    }),
  );
  assert.equal(partial.ok, false);
  assert.match(partial.errors.join(";"), /did not confirm every/);
});

test("YouTube cron requires authorization and reports cache errors before touching providers", async () => {
  process.env.CRON_SECRET = "synthetic-secret";
  process.env.YOUTUBE_API_KEY = "synthetic-key";
  const operations = {
    refresh: () => {
      throw new Error("synthetic cache failure");
    },
    sync: async () =>
      assert.fail("failed invalidation must not call providers"),
  };
  assert.equal(
    (await handleYouTubeSync(new Request("https://example.test"), operations))
      .status,
    401,
  );
  const response = await handleYouTubeSync(
    new Request("https://example.test", {
      headers: { authorization: "Bearer synthetic-secret" },
    }),
    operations,
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).ok, false);
});
