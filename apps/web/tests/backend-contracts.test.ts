import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { POST as signup } from "../app/api/newsletter/route";
import { POST as image } from "../app/api/ai/generate-image/route";
import { GET as headlines } from "../app/api/news/headlines/route";
import { readJsonObject, InputError } from "../lib/api-input";
import {
  deliverNewsletterEdition,
  NewsletterDeliveryError,
  type NewsletterLedger,
} from "../lib/newsletter-delivery";
import { renderRaceWeekBriefing } from "../lib/email-templates";
import { clientIp, rateLimit } from "../lib/rate-limit";

const keys = [
  "NODE_ENV",
  "VERCEL_ENV",
  "ADMIN_PASSWORD",
  "HUGGINGFACE_TOKEN",
  "HUGGINGFACE_INFERENCE_ENABLED",
  "RESEND_API_KEY",
  "RESEND_AUDIENCE_ID",
  "RESEND_FROM_EMAIL",
  "VERCEL",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;
const originals = Object.fromEntries(
  keys.map((key) => [key, process.env[key]]),
);
const originalFetch = globalThis.fetch;
let identity = 0;
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.UPSTASH_REDIS_REST_URL = "https://synthetic.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "synthetic-redis-token";
  mockFetch(async () => {
    throw new Error("Unexpected external call in offline test");
  });
});
function mockFetch(handler: typeof fetch) {
  globalThis.fetch = async (url, init) =>
    String(url).startsWith("https://synthetic.upstash.io")
      ? Response.json({ result: [1, 60_000] })
      : handler(url, init);
}
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originals[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: originals[key] });
  }
});
function mutation(body: unknown, privileged = false): Request {
  return new Request("https://apex.example/api/test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://apex.example",
      "x-vercel-forwarded-for": `192.0.2.${++identity}`,
      ...(privileged
        ? { Authorization: `Basic ${btoa("apex:synthetic-password")}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

test("newsletter never confirms or captures when provider configuration is unavailable", async () => {
  let requests = 0;
  mockFetch(async () => {
    requests++;
    throw new Error("unexpected");
  });
  const response = await signup(mutation({ email: "reader@example.com" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(requests, 0);
});

test("invalid newsletter payloads and foreign browser requests never reach provider", async () => {
  for (const body of [
    null,
    [],
    { email: 123 },
    { email: ["reader@example.com"] },
    { email: "bad" },
  ]) {
    assert.equal((await signup(mutation(body))).status, 400);
  }
  const response = await signup(
    new Request("https://apex.example/api/newsletter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://foreign.example",
      },
      body: '{"email":"reader@example.com"}',
    }),
  );
  assert.equal(response.status, 403);
});

test("saved subscription is distinct from failed welcome delivery", async () => {
  process.env.RESEND_API_KEY = "synthetic-key";
  process.env.RESEND_AUDIENCE_ID = "synthetic-audience";
  process.env.RESEND_FROM_EMAIL = "news@example.com";
  const requests: string[] = [];
  mockFetch(async (url) => {
    requests.push(String(url));
    return String(url).endsWith("/emails")
      ? Response.json({ message: "rejected" }, { status: 403 })
      : Response.json({ id: "contact-1" });
  });
  const response = await signup(mutation({ email: "reader@example.com" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    mode: "resend",
    id: "contact-1",
    welcomeStatus: "failed",
  });
  assert.equal(requests.length, 2);
});

test("existing unsubscribed contact cannot be reported as subscribed", async () => {
  process.env.RESEND_API_KEY = "synthetic-key";
  process.env.RESEND_AUDIENCE_ID = "synthetic-audience";
  mockFetch(async (_url, init) =>
    init?.method === "POST"
      ? Response.json({}, { status: 409 })
      : Response.json({ id: "existing", unsubscribed: true }),
  );
  const response = await signup(mutation({ email: "reader@example.com" }));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
});
test("empty welcome acknowledgement cannot be reported as sent after a real subscription save", async () => {
  process.env.RESEND_API_KEY = "synthetic-key";
  process.env.RESEND_AUDIENCE_ID = "synthetic-audience";
  process.env.RESEND_FROM_EMAIL = "news@example.com";
  mockFetch(async url => String(url).endsWith("/emails") ? Response.json({ id: "" }) : Response.json({ id: "contact-empty-welcome" }));
  const response = await signup(mutation({ email: "empty-welcome@example.com" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.welcomeStatus, "failed");
});

test("invalid image payloads never spend inference, even with configured credentials", async () => {
  process.env.ADMIN_PASSWORD = "synthetic-password";
  process.env.HUGGINGFACE_TOKEN = "synthetic-token";
  process.env.HUGGINGFACE_INFERENCE_ENABLED = "true";
  let requests = 0;
  mockFetch(async () => {
    requests++;
    throw new Error("unexpected inference");
  });
  for (const body of [
    null,
    { prompt: 123 },
    { prompt: [] },
    { prompt: "" },
    { prompt: "Track", style: "unknown" },
    { prompt: "Track", aspect: "unknown" },
  ]) {
    assert.equal((await image(mutation(body, true))).status, 400);
  }
  assert.equal(requests, 0);
  assert.equal((await image(mutation({ prompt: "Track" }))).status, 401);
});

test("bounded body parsing rejects oversize and primitive JSON", async () => {
  await assert.rejects(
    readJsonObject(mutation({ text: "a".repeat(100) }), 16),
    (error: unknown) => error instanceof InputError && error.status === 413,
  );
  await assert.rejects(
    readJsonObject(mutation("text")),
    /JSON object required/,
  );
});

test("configured inference cannot run when the deployed shared quota is unavailable", async () => {
  process.env.ADMIN_PASSWORD = "synthetic-password";
  process.env.HUGGINGFACE_TOKEN = "synthetic-token";
  process.env.HUGGINGFACE_INFERENCE_ENABLED = "true";
  delete process.env.UPSTASH_REDIS_REST_URL;
  let requests = 0;
  mockFetch(async () => {
    requests++;
    throw new Error("inference must not run");
  });
  const response = await image(mutation({ prompt: "Track" }, true));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
  assert.equal(requests, 0);
});

test("cached headlines have stable identities, dedupe canonical source links and reject invalid limits", async () => {
  const called: string[] = [];
  globalThis.fetch = async (url) => {
    called.push(String(url));
    return new Response(
      '<rss version="2.0"><channel><title>Feed</title><item><title>F1 strategy update</title><link>https://source.example/story?utm_source=wire</link><pubDate>Wed, 30 Sep 2026 00:00:00 GMT</pubDate></item><item><title>F1 different headline</title><link>https://source.example/story</link><pubDate>Wed, 30 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>',
    );
  };
  const first = await headlines(
    new Request("https://apex.example/api/news/headlines?limit=2"),
  );
  const second = await headlines(
    new Request("https://apex.example/api/news/headlines?limit=2"),
  );
  assert.equal(first.status, 200);
  assert.match(first.headers.get("cache-control")!, /s-maxage=300/);
  const body = await first.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].link, "https://source.example/story");
  assert.equal(body.items[0].id, (await second.json()).items[0].id);
  assert.ok(called.length > 0);
  assert.ok(
    called.every(
      (url) => !/newsapi|newsdata|currents|theguardian\.com/.test(url),
    ),
  );
  assert.equal(
    (
      await headlines(
        new Request("https://apex.example/api/news/headlines?limit=999"),
      )
    ).status,
    400,
  );
});

test("headline provider outage is unavailable rather than a successful fake empty feed", async () => {
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  const response = await headlines(
    new Request("https://apex.example/api/news/headlines"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).ok, false);
});

const deliveryInput = {
  key: "race:2026:test",
  apiKey: "synthetic-key",
  audienceId: "synthetic-audience",
  fromEmail: "news@example.com",
  fromName: "Apex",
  email: { subject: "Test", html: "Test", text: "Test" },
};
function memoryLedger() {
  let state = "reserved";
  let remoteId: string | null = null;
  const events: string[] = [];
  const ledger: NewsletterLedger = {
    reserveNewsletterEdition: async () =>
      state === "sent"
        ? { status: "already-sent", broadcastId: remoteId }
        : state === "reserved"
          ? { status: "acquired", leaseToken: "lease", broadcastId: null }
          : { status: "needs-review", broadcastId: remoteId },
    markNewsletterCreating: async () => {
      state = "creating";
      events.push("creating");
    },
    recordNewsletterBroadcast: async (_key, id) => {
      remoteId = id;
      state = "broadcast_created";
      events.push("record-id");
    },
    markNewsletterSending: async () => {
      state = "sending";
      events.push("sending");
    },
    markNewsletterSent: async () => {
      state = "sent";
      events.push("sent");
    },
    markNewsletterFailed: async (_key, _reason, _token, options) => {
      state = options?.uncertain ? "uncertain" : "failed";
      events.push(state);
    },
  };
  return { ledger, events, state: () => state };
}

test("repeated successful newsletter invocation creates and sends exactly once", async () => {
  const record = memoryLedger();
  let calls = 0;
  const fetcher: typeof fetch = async (url) => {
    calls++;
    record.events.push(
      String(url).endsWith("/send") ? "provider-send" : "provider-create",
    );
    return Response.json({ id: "broadcast-1" });
  };
  assert.equal(
    (await deliverNewsletterEdition(deliveryInput, record.ledger, fetcher))
      .status,
    "sent",
  );
  assert.equal(
    (await deliverNewsletterEdition(deliveryInput, record.ledger, fetcher))
      .status,
    "already-sent",
  );
  assert.equal(calls, 2);
  assert.deepEqual(record.events, [
    "creating",
    "provider-create",
    "record-id",
    "sending",
    "provider-send",
    "sent",
  ]);
});

test("ambiguous broadcast creation and delivery never automatically retry", async () => {
  for (const failSend of [false, true]) {
    const record = memoryLedger();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      if (!failSend || calls === 2) throw new Error("network timeout");
      return Response.json({ id: "broadcast-1" });
    };
    await assert.rejects(
      deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
      (error: unknown) =>
        error instanceof NewsletterDeliveryError && error.uncertain,
    );
    assert.equal(record.state(), "uncertain");
    await assert.rejects(
      deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
      (error: unknown) =>
        error instanceof NewsletterDeliveryError && error.status === 409,
    );
    assert.equal(calls, failSend ? 2 : 1);
  }
});

test("successful remote create with failed durable id write cannot create another broadcast", async () => {
  const record = memoryLedger();
  let calls = 0;
  record.ledger.recordNewsletterBroadcast = async () => {
    throw new Error("database unavailable");
  };
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ id: "broadcast-1" });
  };
  await assert.rejects(
    deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
  );
  await assert.rejects(
    deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
  );
  assert.equal(calls, 1);
  assert.equal(record.state(), "uncertain");
});

test("failed delivery acknowledgement keeps an accepted provider send uncertain without resending", async () => {
  const record = memoryLedger();
  let calls = 0;
  record.ledger.markNewsletterSent = async () => {
    throw new Error("database acknowledgement unavailable");
  };
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ id: "broadcast-1" });
  };
  await assert.rejects(
    deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
    (error: unknown) =>
      error instanceof NewsletterDeliveryError && error.uncertain,
  );
  await assert.rejects(
    deliverNewsletterEdition(deliveryInput, record.ledger, fetcher),
  );
  assert.equal(calls, 2);
  assert.equal(record.state(), "uncertain");
});

test("briefing includes a real broadcast unsubscribe placeholder and only safe source links", () => {
  const result = renderRaceWeekBriefing({
    next: null,
    driverStandings: [],
    standingsSeason: null,
    issuedAtMs: Date.parse("2026-10-25T00:00:00Z"),
    siteUrl: "https://apex.example/",
    articles: [
      {
        title: "<script>",
        source: "Source",
        link: "javascript:alert(1)",
        pubDateMs: 0,
      },
      {
        title: "News",
        source: "Source",
        link: "https://source.example/story",
        pubDateMs: 0,
      },
    ],
  });
  assert.match(result.html, /href="\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}"/);
  assert.match(result.text, /Unsubscribe: \{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.doesNotMatch(
    result.html,
    /javascript:|Reply unsubscribe|Eight stories/,
  );
  assert.match(result.html, /1 story from the wire/);
  assert.match(result.html, /&copy; 2026 APEX/);
});

test("briefing standings link follows the standings season from Jolpica, never the clock", () => {
  const base = {
    next: { name: "Mexico City Grand Prix", country: "Mexico", raceStartIso: "2026-11-01T20:00:00Z", slug: "mexico", season: 2026 },
    articles: [],
    driverStandings: [{ position: 1, driverName: "Lando Norris", teamName: "McLaren", points: 300 }],
    siteUrl: "https://apex.example/",
    issuedAtMs: Date.parse("2027-01-02T00:00:00Z"),
  };
  assert.match(renderRaceWeekBriefing({ ...base, standingsSeason: 2026 }).html, /href="https:\/\/apex\.example\/results\/2026\/drivers"/);
  const unknown = renderRaceWeekBriefing({ ...base, standingsSeason: null }).html;
  assert.match(unknown, /href="https:\/\/apex\.example\/results\/archive"/);
  assert.doesNotMatch(unknown, /results\/2027/);
});

test("proxy headers cannot mint independent identities outside trusted Vercel hosting", () => {
  delete process.env.VERCEL;
  const request = new Request("https://apex.example", {
    headers: {
      "x-vercel-forwarded-for": "192.0.2.1",
      "x-real-ip": "192.0.2.2",
      "x-forwarded-for": "192.0.2.3",
    },
  });
  assert.equal(clientIp(request), "unattributed");
  const bucket = `test-${Date.now()}`;
  assert.equal(
    rateLimit(request, { bucket, limit: 1, windowMs: 60_000 }).ok,
    true,
  );
  assert.equal(
    rateLimit(
      new Request("https://apex.example", {
        headers: { "x-forwarded-for": "192.0.2.4" },
      }),
      { bucket, limit: 1, windowMs: 60_000 },
    ).ok,
    false,
  );
});
