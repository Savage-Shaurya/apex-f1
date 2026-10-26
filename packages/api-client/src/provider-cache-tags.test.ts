import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { getF1NewsFeed, F1_RSS_SOURCES, type NewsSourceReport } from "./rss";
import { getF1Videos } from "./youtube";
import { getGuardianF1News } from "./guardian";
import { getGNewsF1News } from "./gnews";
import { getCurrentsF1News } from "./currents";
import { getNewsDataF1News } from "./newsdata";
import { getNewsAPIF1News } from "./newsapi";
import { openmeteo, raceWeatherDateBounds } from "./openmeteo";
import {
  NEWS_CACHE_TAG,
  RSS_NEWS_CACHE_TAG,
  VIDEO_CACHE_TAG,
  WEATHER_CACHE_TAG,
} from "./cache-tags";
import { ProviderError } from "./transport";

const keys = [
  "GUARDIAN_API_KEY",
  "CURRENTS_API_KEY",
  "NEWSDATA_API_KEY",
  "NEWSAPI_KEY",
  "GNEWS_API_KEY",
  "YOUTUBE_API_KEY",
  "OPENMETEO_API_KEY",
];
let previous: Map<string, string | undefined>;
let originalFetch: typeof fetch;
beforeEach(() => {
  previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Unexpected unmocked network in provider cache fixtures.");
  };
});
afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
});

type CacheHints = { revalidate: number; tags?: string[] };
function cacheHints(init: RequestInit | undefined): CacheHints {
  const hints = (init as (RequestInit & { next?: CacheHints }) | undefined)
    ?.next;
  assert.ok(hints, "Provider request must explicitly configure its cache.");
  return hints;
}
const rss =
  '<rss version="2.0"><channel><item><title>Formula 1 fixture story</title><link>https://fixture.invalid/f1-story</link><pubDate>Fri, 02 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
const atom =
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Formula 1 fixture video</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-10-02T12:00:00Z</published></entry></feed>';

test("news RSS requests share news and RSS tags without changing their requested TTL", async () => {
  const seen: CacheHints[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    seen.push(cacheHints(init));
    return new Response(rss, {
      headers: { "content-type": "application/rss+xml" },
    });
  };
  const items = await getF1NewsFeed({
    strict: true,
    fetchImpl,
    revalidate: 300,
  });
  assert.ok(items.length > 0);
  assert.equal(seen.length, F1_RSS_SOURCES.length);
  for (const hints of seen) {
    assert.equal(hints.revalidate, 300);
    assert.deepEqual(hints.tags, [NEWS_CACHE_TAG, RSS_NEWS_CACHE_TAG]);
  }
});

test("YouTube RSS has video tags and stays outside the news invalidation group", async () => {
  let calls = 0;
  const videos = await getF1Videos({
    forceRss: true,
    strict: true,
    revalidate: 1800,
    channels: [{ name: "Fixture channel", channelId: "fixture-channel" }],
    fetchImpl: async (input, init) => {
      calls++;
      assert.equal(
        new URL(String(input)).searchParams.get("channel_id"),
        "fixture-channel",
      );
      const hints = cacheHints(init);
      assert.equal(hints.revalidate, 1800);
      assert.deepEqual(hints.tags, [VIDEO_CACHE_TAG, "videos:rss"]);
      assert.ok(!hints.tags?.includes(NEWS_CACHE_TAG));
      assert.ok(!hints.tags?.includes(RSS_NEWS_CACHE_TAG));
      return new Response(atom, {
        headers: { "content-type": "application/atom+xml" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(videos[0]?.videoId, "abcdefghijk");
});

test("credentialed news keeps per-provider tags and cache floors for frequent callers", async () => {
  process.env.GUARDIAN_API_KEY = "fixture-guardian";
  process.env.CURRENTS_API_KEY = "fixture-currents";
  process.env.NEWSDATA_API_KEY = "fixture-newsdata";
  process.env.NEWSAPI_KEY = "fixture-newsapi";
  process.env.GNEWS_API_KEY = "fixture-gnews";
  const providers = [
    {
      name: "gnews",
      floor: 1200,
      call: getGNewsF1News,
      fixture: { articles: [] },
    },
    {
      name: "guardian",
      floor: 600,
      call: getGuardianF1News,
      fixture: { response: { status: "ok", results: [] } },
    },
    {
      name: "currents",
      floor: 600,
      call: getCurrentsF1News,
      fixture: { status: "ok", news: [] },
    },
    {
      name: "newsdata",
      floor: 600,
      call: getNewsDataF1News,
      fixture: { status: "success", results: [] },
    },
    {
      name: "newsapi",
      floor: 1000,
      call: getNewsAPIF1News,
      fixture: { status: "ok", articles: [] },
    },
  ];
  for (const provider of providers) {
    for (const requested of [30, 4000]) {
      let calls = 0;
      const fetchImpl: typeof fetch = async (_input, init) => {
        calls++;
        const hints = cacheHints(init);
        assert.equal(
          hints.revalidate,
          Math.max(provider.floor, requested),
          provider.name,
        );
        assert.deepEqual(hints.tags, [NEWS_CACHE_TAG, `news:${provider.name}`]);
        assert.ok(!hints.tags?.includes(RSS_NEWS_CACHE_TAG));
        return Response.json(provider.fixture);
      };
      assert.deepEqual(
        await provider.call({ fetchImpl, strict: true, revalidate: requested }),
        [],
      );
      assert.equal(calls, 1);
    }
  }
});

test("weather distinguishes forecast and archive tags and default retention", async () => {
  const today = Date.parse(
    `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
  );
  for (const sample of [
    { offset: 1, source: "forecast", ttl: 3600 },
    { offset: -7, source: "archive", ttl: 604800 },
  ]) {
    const date = new Date(today + sample.offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    let calls = 0;
    const result = await openmeteo.getRaceWeather({
      lat: 1.3,
      lon: 103.8,
      dateStart: date,
      dateEnd: date,
      strict: true,
      fetchImpl: async (input, init) => {
        calls++;
        const url = new URL(String(input));
        // The request is padded one day each side for the circuit's local days.
        const day = (shift: number) => new Date(Date.parse(`${date}T00:00:00Z`) + shift * 86_400_000).toISOString().slice(0, 10);
        assert.equal(url.searchParams.get("start_date"), day(-1));
        assert.equal(url.searchParams.get("end_date"), day(1));
        assert.equal(
          url.hostname,
          sample.source === "forecast"
            ? "api.open-meteo.com"
            : "archive-api.open-meteo.com",
        );
        const hints = cacheHints(init);
        assert.equal(hints.revalidate, sample.ttl);
        assert.deepEqual(hints.tags, [
          WEATHER_CACHE_TAG,
          `weather:${sample.source}`,
        ]);
        return Response.json({
          utc_offset_seconds: 0,
          daily: { time: [date], temperature_2m_max: [27] },
        });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result?.source, sample.source);
  }
});

test("shared weather date bounds include the entire weekend and ignore malformed session dates", () => {
  const race = "2026-10-11T13:00:00Z";
  assert.deepEqual(
    raceWeatherDateBounds(
      [
        { iso: race },
        { iso: "2026-10-09T12:00:00Z" },
        { iso: "2026-10-10T14:00:00Z" },
        { iso: "not-a-session-date" },
      ],
      race,
    ),
    { start: "2026-10-09", end: "2026-10-11" },
  );
  assert.deepEqual(raceWeatherDateBounds([], race), {
    start: "2026-10-11",
    end: "2026-10-11",
  });
});

test("partial news failures preserve healthy stories and expose only redacted source health", async () => {
  process.env.NEWSAPI_KEY = "private-fixture-token";
  const reports: NewsSourceReport[] = [];
  const items = await getF1NewsFeed({
    strict: true,
    onSourceResult: (report) => {
      reports.push(report);
    },
    fetchImpl: async (input) => {
      const hostname = new URL(String(input)).hostname;
      if (hostname === "www.motorsport.com") return new Response(rss);
      if (hostname === "www.autosport.com")
        throw new Error(
          "private-fixture-token https://credential.invalid?secret=hidden",
        );
      if (hostname === "www.racefans.net")
        return new Response("private-fixture-token upstream body", {
          status: 403,
        });
      if (hostname === "www.the-race.com")
        return new Response("<html>private-fixture-token upstream body</html>");
      assert.equal(hostname, "newsapi.org");
      return new Response("private-fixture-token upstream body", {
        status: 401,
      });
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.source, "Motorsport.com");
  assert.equal(reports.length, F1_RSS_SOURCES.length + 1);
  assert.deepEqual(
    reports.find((report) => report.source === "Motorsport.com"),
    { source: "Motorsport.com", ok: true, items: 1 },
  );
  assert.equal(reports.filter((report) => !report.ok).length, 4);
  assert.ok(
    reports.some((report) => !report.ok),
    "The cron can derive degraded:true without dropping healthy rows.",
  );
  assert.match(
    reports.find((report) => report.source === "RaceFans")?.error ?? "",
    /HTTP 403/,
  );
  assert.match(
    reports.find((report) => report.source === "NewsAPI")?.error ?? "",
    /HTTP 401/,
  );
  assert.doesNotMatch(
    JSON.stringify(reports),
    /private-fixture-token|credential\.invalid|secret=|upstream body/,
  );
});

test("all failed news sources reject a strict sync and still return redacted per-source reports", async () => {
  const reports: NewsSourceReport[] = [];
  await assert.rejects(
    getF1NewsFeed({
      strict: true,
      onSourceResult: (report) => {
        reports.push(report);
      },
      fetchImpl: async () => {
        throw new Error("private-fixture-token unexpected raw error");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.provider, "news-feed");
      assert.equal(error.code, "network");
      assert.doesNotMatch(error.message, /private-fixture-token|raw error/);
      return true;
    },
  );
  assert.equal(reports.length, F1_RSS_SOURCES.length);
  assert.ok(reports.every((report) => !report.ok && report.items === 0));
  assert.doesNotMatch(
    JSON.stringify(reports),
    /private-fixture-token|raw error/,
  );
});
