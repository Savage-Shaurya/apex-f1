import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET as syncYouTube } from "../app/api/cron/youtube-sync/route";
import { handleYouTubeSync } from "../lib/youtube-cron";
import {
  syncRecentYouTubeUploads,
  youtubeSyncReaders,
} from "../lib/youtube-sync";
import { GET as blastNewsletter } from "../app/api/cron/newsletter-blast/route";
import { jolpica } from "@apex/api-client/jolpica";
import {
  searchYouTubeF1Videos,
  YT_F1_CHANNELS,
} from "@apex/api-client/youtube";
import { persistCurrentSeason, persistVideos } from "@apex/db";
import {
  deliverNewsletterEdition,
  NewsletterDeliveryError,
  type NewsletterLedger,
} from "../lib/newsletter-delivery";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.CRON_SECRET;
const originalYouTubeKey = process.env.YOUTUBE_API_KEY;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalResendKey = process.env.RESEND_API_KEY;
const originalAudience = process.env.RESEND_AUDIENCE_ID;
const originalFromEmail = process.env.RESEND_FROM_EMAIL;
const originalSchedule = jolpica.getSchedule;
const originalStandings = jolpica.getDriverStandings;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalYouTubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalYouTubeKey;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendKey;
  if (originalAudience === undefined) delete process.env.RESEND_AUDIENCE_ID;
  else process.env.RESEND_AUDIENCE_ID = originalAudience;
  if (originalFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFromEmail;
  jolpica.getSchedule = originalSchedule;
  jolpica.getDriverStandings = originalStandings;
});

function authorizedRequest() {
  return new Request("http://localhost/api/cron/youtube-sync", {
    headers: { Authorization: "Bearer test-cron-secret" },
  });
}

// Cache invalidation is a Next route capability; fixtures exercise its injected boundary.
const syncYouTubeFixture = (request: Request) =>
  handleYouTubeSync(request, {
    refresh: () => {},
    sync: () =>
      syncRecentYouTubeUploads({
        ...youtubeSyncReaders,
        persist: async () => {
          assert.fail(
            "Empty/failing playlist fixtures must never attempt persistence.",
          );
        },
      }),
  });

function fixtureChannels() {
  return {
    items: YT_F1_CHANNELS.map((channel) => ({
      id: channel.channelId,
      snippet: { title: channel.name, description: "", thumbnails: {} },
      contentDetails: {
        relatedPlaylists: { uploads: `UU${channel.channelId.slice(2)}` },
      },
    })),
  };
}

test("YouTube cron rejects missing API key with a failing HTTP status", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.YOUTUBE_API_KEY;
  const response = await syncYouTube(authorizedRequest());
  const report = await response.json();
  assert.equal(response.status, 503);
  assert.equal(report.ok, false);
  assert.match(report.error, /YOUTUBE_API_KEY missing/);
});

test("strict YouTube requests expose upstream errors while render requests fall back", async () => {
  process.env.YOUTUBE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response("{}", { status: 403 });
  await assert.rejects(searchYouTubeF1Videos({ strict: true }), /HTTP 403/);
  assert.deepEqual(await searchYouTubeF1Videos(), []);
});

test("YouTube cron marks a partial channel failure as failed", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.YOUTUBE_API_KEY = "test-key";
  delete process.env.DATABASE_URL;
  const failedChannel = YT_F1_CHANNELS[0]!.channelId;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/channels"))
      return Response.json(fixtureChannels());
    if (url.pathname.endsWith("/playlistItems")) {
      if (
        url.searchParams.get("playlistId") === `UU${failedChannel.slice(2)}`
      ) {
        // YouTube's own JSON refusal (not a quota reply): a hard failure, never an outage.
        return Response.json({ error: { code: 403, errors: [{ reason: "forbidden" }] } }, { status: 403 });
      }
      return Response.json({ items: [] });
    }
    throw new Error(`Unexpected URL: ${url.pathname}`);
  };
  const response = await syncYouTubeFixture(authorizedRequest());
  const report = await response.json();
  assert.equal(response.status, 500);
  assert.equal(report.ok, false);
  assert.equal(
    report.channels.filter((channel: { error?: string }) => channel.error)
      .length,
    1,
  );
  assert.match(report.channels[0].error, /HTTP 403/);
});

test("YouTube cron accepts successful empty uploads playlists", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.YOUTUBE_API_KEY = "test-key";
  delete process.env.DATABASE_URL;
  globalThis.fetch = async (input) =>
    new URL(String(input)).pathname.endsWith("/channels")
      ? Response.json(fixtureChannels())
      : Response.json({ items: [] });
  const response = await syncYouTubeFixture(authorizedRequest());
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.equal(report.ok, true);
  assert.equal(report.channels.length, YT_F1_CHANNELS.length);
  assert.equal(report.totals.videosFetched, 0);
});

test("configured database failures propagate instead of reporting zero writes", async () => {
  process.env.DATABASE_URL = "not-a-url";
  await assert.rejects(
    persistVideos([{ videoId: "abcdefghijk", title: "Video" }]),
    /Failed to persist videos/,
  );
  await assert.rejects(
    persistCurrentSeason(2026, [], [], { driverRound: null, teamRound: null }),
    /Failed to persist standings snapshot/,
  );
});

test("newsletter cron reports missing delivery configuration as a failure before fetching", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  globalThis.fetch = async () => {
    throw new Error("unexpected fetch");
  };
  const request = new Request("http://localhost/api/cron/newsletter-blast", {
    headers: { Authorization: "Bearer test-cron-secret" },
  });

  for (const missing of [
    "RESEND_API_KEY",
    "RESEND_AUDIENCE_ID",
    "RESEND_FROM_EMAIL",
    "DATABASE_URL",
  ] as const) {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_AUDIENCE_ID = "test-audience";
    process.env.RESEND_FROM_EMAIL = "news@example.com";
    process.env.DATABASE_URL = "not-a-url";
    delete process.env[missing];
    const response = await blastNewsletter(request);
    const report = await response.json();
    assert.equal(response.status, 503);
    assert.equal(report.ok, false);
    assert.match(report.error, new RegExp(missing));
  }

  process.env.RESEND_FROM_EMAIL = "onboarding@resend.dev";
  process.env.DATABASE_URL = "not-a-url";
  const response = await blastNewsletter(request);
  const report = await response.json();
  assert.equal(response.status, 503);
  assert.equal(report.ok, false);
  assert.match(report.error, /verified custom domain/);
});

test("newsletter delivery exposes rejected broadcast as failure, not a healthy skip", async () => {
  const states: string[] = [];
  const ledger: NewsletterLedger = {
    reserveNewsletterEdition: async () => ({
      status: "acquired",
      leaseToken: "test-lease",
      broadcastId: null,
    }),
    markNewsletterCreating: async () => {
      states.push("creating");
    },
    recordNewsletterBroadcast: async () => {
      assert.fail("rejected broadcast has no id");
    },
    markNewsletterSending: async () => {
      assert.fail("must not send rejected broadcast");
    },
    markNewsletterSent: async () => {
      assert.fail("must not mark rejected broadcast sent");
    },
    markNewsletterFailed: async (_key, _reason, _token, options) => {
      states.push(options?.uncertain ? "uncertain" : "failed");
    },
  };
  await assert.rejects(
    deliverNewsletterEdition(
      {
        key: "test-edition",
        apiKey: "synthetic-key",
        audienceId: "synthetic-audience",
        fromEmail: "news@example.com",
        fromName: "Apex",
        email: { subject: "Test", html: "Test", text: "Test" },
      },
      ledger,
      async () => new Response("Domain not verified", { status: 403 }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof NewsletterDeliveryError);
      assert.equal(error.status, 500);
      assert.equal(error.uncertain, false);
      assert.match(
        error.message,
        /resend broadcast create 403: provider rejected request/,
      );
      return true;
    },
  );
  assert.deepEqual(states, ["creating", "failed"]);
});
