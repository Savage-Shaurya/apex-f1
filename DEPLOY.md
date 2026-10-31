# Deploying Apex

The short version is in the README's Deploy section. This page lists what each environment needs and the checks to run before and after a release. The full release and recovery procedure is the [release runbook](docs/operations/RELEASE-RUNBOOK.md).

## Before a release

1. From a clean clone: `pnpm install --frozen-lockfile`, then `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.
2. Start the build (`pnpm --filter @apex/web start`) and run `APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate`.
3. `pnpm audit:checked` must report no production advisories.

## Hosting (Vercel)

- Project root directory: `apps/web`. Node 22.
- Environment variables: every name in [`apps/web/.env.example`](apps/web/.env.example). Keep development, preview and production values separate, and keep secrets only in the host's secret store.
- Required in production: `NEXT_PUBLIC_SITE_URL` (canonical HTTPS origin; the build and server stop without it) and `CRON_SECRET`. Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) is optional: it shares rate limits, provider budgets and fallback copies across instances, and holds admin sessions (see "Redis is optional" below).
- Optional services switch on when their variables are set and show an honest "unavailable" state otherwise: news providers, YouTube, Resend newsletter, PostgreSQL (predictions and articles), the admin editor, and PostHog analytics. The cookie banner appears only when an analytics key is configured.
- Crons in `apps/web/vercel.json` call `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`.

## GitHub Actions

- Repository variable `APEX_SITE_URL`: the same origin as `NEXT_PUBLIC_SITE_URL`.
- Secret `CRON_SECRET`: used by the refresh workflows (`refresh-*.yml`) to call the cron routes.
- Database backups (`db-backup.yml`): `SUPABASE_BACKUP_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `SUPABASE_DB_CA_CERT`. Restore steps: [`scripts/ops/restore-db.md`](scripts/ops/restore-db.md).
- CI (`ci.yml`) runs the frozen install, dependency audit, typecheck, lint, tests, build and the quick quality gate with no service credentials.
- CI Lighthouse (`.github/lighthouserc.json`) uses real (devtools) throttling. Performance must be at least 0.70 (owner decision, 2026-10-27: the full-bleed news hero scored 0.71-0.79 on a throttled phone); accessibility 0.95, SEO 0.95, best practices 0.90.

## Cron outcomes and provider outages (2026-10-31)

Jolpica F1 is free and its origin is overloaded on race weekends (uncached reads time out after 60 s; its edge can answer 4xx). Every scheduled job treats a temporary upstream outage as "deferred", not as a failure, and still fails loudly on our own bugs and on a prolonged outage.

- **Classification** (`classifyProviderFailure`, `packages/api-client/src/transport.ts`): timeouts/aborts, socket failures (DNS, reset, refused, closed: only these error codes, never any other thrown error), 408/425/429, 5xx, a quota reply (YouTube `quotaExceeded`/`rateLimitExceeded`, the only failed-response body ever read: JSON 403, 4 KB, 250 ms), and a 400/403 whose content type is not JSON (an edge page) are `provider-unavailable`. Who answered is decided by the content type alone, so a large or slow JSON error is still the provider's. A permanent 301/308 move, TLS/certificate errors and any other exception thrown inside a provider read (our own TypeError, ReferenceError, assertion) are hard failures. The provider's own JSON 4xx (Jolpica answers a bad path with `{"detail":"Bad Request: …"}`), 401, a non-quota 403, every 404/405/410/422, configuration, invalid or truncated data, a pagination total mismatch and our own exceptions are hard failures. Upstash failures are never provider failures: they are `redis-unavailable` and the read continues on process-local pacing (see "Redis is optional"). The job database counts as unavailable only for connection failures (`ECONNREFUSED`, `ETIMEDOUT`, SQLSTATE 08xxx/57P01-57P03/53xxx); auth (28xxx) and SQL errors are ours.
- **Calendar fallback**: `weather-sync` and `weekend-watch` only need the calendar, which barely changes. While Jolpica is unavailable they run on the last validated copy (this process, else the shared `…:last-good:` copy in Upstash when it is available) up to 7 days old, and their 200 report says `degraded: true`, `results.calendar: { source: "last-good", storedAt }`.
- **Contract** (`apps/web/lib/cron-outcome.ts`): when work is deferred only because a provider is unavailable, a cron route answers **HTTP 503** with `Retry-After: 120` and `{ ok: false, route, retryable: true, reason: "provider-unavailable", provider, error, lastSuccessAt }`. `provider` is `jolpica`, `openmeteo`, `news-sources` (every news source down), `youtube` or `database`. `lastSuccessAt` (ISO or `null`) is the route's last **full** ok report, kept per route in Upstash (`apex:cron:v1:last-success:<route>`, environment-scoped like every other key, 30 days) and in the serving process. Every other failure keeps HTTP 500 (or 401 / a plain 503 for auth, configuration or lease problems) and never carries `retryable`. Some news sources failing, or a run on the last-good calendar, is a degraded 200: it records only `lastDegradedAt` (`apex:cron:v1:last-degraded:<route>`), never `lastSuccessAt`, and carries `lastSuccessAt` so the runner can judge it.
- **Cron workflows** (`scripts/invoke-cron.mjs`; news, weather, weekend, videos, season): a provider-unavailable report, 502/504 or a dropped connection to our own site is retried after 30 s and 90 s (three attempts; retries and `--until-complete` continuations stop inside a 7-minute budget, so a run lasts at most about 8 minutes; workflow timeouts are 10 min, season 15). If the provider is still unavailable the run ends **green with a `::warning::`** and a job-summary line while `lastSuccessAt` is within 48 h (`weather-sync`, `rss-sync`, `youtube-sync`), 72 h (`jolpica-nightly`) or 120 h (`weekend-watch`, which only runs Friday to Monday: its Monday-to-Friday gap is 89 h; every limit must cover the schedule gap + 24 h, checked by `scripts/cron-coverage.test.mjs`), and **red** once it is older. A degraded 200 follows the same rule: green with a warning only while the last full success is within the limit, otherwise red, so days of fallback runs cannot hide a permanent breakage, unknown (`null`, e.g. Upstash unset or first run) or malformed. Our own site failing (DNS, refused, Vercel 502/504) is retried and then red, never shown as a provider outage; a 500, 401, plain 503 or malformed report is red at once. The invoker accepts `http://localhost`/`127.0.0.1` for local checks; `APEX_CRON_RETRY_DELAYS_SECONDS` (e.g. `5,10`) shortens the waits for a local simulation.
- **Other scheduled jobs** (`scripts/ops/scheduled-job.mjs`; `db-backup.yml`, `dependency-security.yml`): the job's command exits 75 (EX_TEMPFAIL) for an upstream outage (`backup-db.mjs`: Supabase database or Storage unreachable/5xx/429; `dependency-audit.mjs`: npm registry unreachable/5xx), or, with `--npm-output`, pnpm's output shows a registry/network failure. Same retries; still down → green + warning while the last **verified** success (the newest earlier run whose `Record verified success` step ran; read with `GITHUB_TOKEN`, `actions: read`) is within 48 h (backup) / 72 h (dependency audit), else red. Only runs of that workflow file on the default branch, started by `schedule` or `workflow_dispatch` from this repository, count (a fork pull request or another branch cannot plant the marker). A deferred run never runs that step, so warnings cannot hide a prolonged outage. `GITHUB_TOKEN` is given to `scheduled-job.mjs` only; it strips it from the wrapped command (pg_dump, pnpm, audit test code). Known limit: if the npm registry is down while `pnpm/action-setup` downloads pnpm, that third-party step fails red.
- **Tests that guard this**: `apps/web/tests/cron-outage-matrix.test.ts` (every route × every failure mode, route report + runner exit code + annotation), `cron-outage-redis.test.ts` (Upstash down/slow/corrupted), `scripts/invoke-cron.test.mjs`, `scripts/ops/scheduled-job.test.mjs`, and `scripts/cron-coverage.test.mjs`, which fails if a workflow calls a cron URL directly, bypasses the runner, or a new cron route has no outage cases.

## Redis key scope and provider budgets (audit F-07, F-02, F-01)

- Every shared budget, quota, backoff and cache key in Upstash is scoped by environment (`packages/api-client/src/redis-scope.ts`). Only the production deployment (`VERCEL_ENV=production`, or `APEX_ENV=production` on a self-hosted production server without `VERCEL_ENV`) uses the unscoped production keys (`apex:jolpica:v1:{jolpica}:quota`, `apex:live:v1:{openf1}:…`, `apex:rl:v1:…`, `apex:openf1:v1:last-good:…`, `apex:weekend-watch:v1:…`). Previews use `apex:preview:…`, local runs `apex:local:…`; `APEX_REDIS_SCOPE=<label>` isolates one worktree, agent or CI job (`apex:local-<label>:…`). Admin session keys are not scoped.
- A local or CI process started with `production.env` therefore never spends or pauses the live site's Jolpica/OpenF1 budget. Prefer a separate Upstash database for non-production anyway, and route local builds through the loopback provider cache (`JOLPICA_BASE_URL`/`OPENF1_BASE_URL` with `APEX_ALLOW_LOCAL_PROVIDER_CACHE=1`).
- A Jolpica 429 pauses only its endpoint class (standings, results, schedule, drivers, …) for its `Retry-After` (default 15 s, at most 120 s), in this instance and through the shared backoff key. Reads in a paused class wait when the pause ends inside their budget; otherwise they answer from the process cache or the shared last-good copy (`…:last-good:` keys, 6 h for live data, any age for completed seasons) before a page shows an outage.
- `next build` never fails because a provider is slow or rate-limited: build reads may queue for 90 s on top of their transport timeout and retry with backoff, every build worker shares one per-build store of validated responses, paths whose data cannot be read are left out of the prebuild (they render on first visit), and a page that still meets an outage while prerendering is served with its honest unavailable state for 60 s, then ISR regenerates it. The route stays ISR (never `ƒ` because of provider weather).

## Redis is optional (incident 2026-10-31)

On 30-31 October the free Upstash plan ran out of its monthly commands (500,000). Upstash then answers every data command with HTTP 400 `ERR max requests limit exceeded` (PING still answers 200). That reply failed every Jolpica read at the shared admission step, so crons answered 500/503 and the production build failed (`jolpica-admission: http (HTTP 400)` while collecting `/teams/[slug]/history`). Upstash is now optional: nothing in the build, a page or a cron depends on it.

- **Startup**: Upstash is not required to start, in production either. Missing or malformed Upstash variables log a `startup.config-warning` (`UPSTASH_REDIS_REST_URL (shared-store-missing)`); the server starts, reads work, writes and admin sign-in answer 503. `DISTRIBUTED_RATE_LIMIT_REQUIRED` was removed (it no longer did anything).
- **Caller cancellations are not Redis failures**: a client disconnect or page deadline aborts with the caller's reason and never counts; only our own Redis deadline (a `TimeoutError` abort reason) does. After a breaker window exactly one call probes (half-open); the others stay local until it succeeds or its 10 s lease ends.
- **A reply our script cannot produce is our bug** (an Upstash command error, a wrong shape from the admission or rate-limit script): logged once per trip at error level (`kind: redis-invalid-reply`) and the breaker opens for 15 minutes, so it does not cost a command per read.
- **One guard for every Upstash call** (`packages/api-client/src/redis-guard.ts`). A quota reply (400 "limit exceeded", 429) or an auth failure (401/403) opens this process's breaker at once for 15 minutes; a transient failure (5xx, 408, timeout, refused or reset connection, a body that is not Upstash JSON) opens it for 30 s after two in a row. While it is open, calls fail at once without a network request. Each trip logs one line `{"event":"redis.breaker.open","kind","consumer","status","retryInMs"}` (never a URL, key or token). A Redis failure is its own class (`classifyProviderFailure` → `redis-unavailable`), never a provider outage and never fatal.
- **What degrades, and to what:**

| Consumer | Without Redis (missing, quota, auth, outage) |
|---|---|
| Jolpica admission (budget, start gap, 429 backoff) | This process's pacing: 260 ms start gap, 500 starts per hour, its own 429 pauses. `next build` never uses the shared admission (also fixes a second bug: its 90 s queue allowance was longer than the 35 s lease, so every build read was refused after reserving). |
| Jolpica / OpenF1 last-good copies | Process cache only. Build writes none. |
| OpenF1 page reads (grid timing) | Direct OpenF1 reads paced at the shared gap (2.3 s) in this process, with the last-good fallback. |
| Rate limits | Reads (`readFallback`: article, prediction and identity reads, live stream opening) keep this instance's in-memory window with the same limit, never unlimited. Every write (newsletter signup and recovery, predictions, identity setup, article writes, image generation) and administrator authentication answers **503 "Temporarily unavailable. Please try again later."** until Redis is back (owner decision 2026-10-31). Admin sessions live in Redis, so nobody can sign in without it. |
| Cron `lastSuccessAt` | Process memory only; unknown (`null`) follows the runner rule above (red once a provider is unavailable). |
| weekend-watch fingerprints | This process remembers every fingerprint it read or wrote; with Redis down a warm instance revalidates and ingests only on a real change. A cold instance revalidates (and, for a race with a database configured, re-ingests) once, then remembers. |
| Championship epochs | Skipped (nothing reads them across processes). |
| `/api/health` | Redis down = `degraded` (200), never `down`; not configured = reported, nothing degraded. The check uses the per-instance limiter and one cached data command (`EXISTS` on a fixed scoped key) per 5 minutes, so a spent quota (where PING still answers 200) reads as down; an open breaker reports down without a call. |
| Admin overview | "Shared store (Redis)": Configured / Unavailable now (quota, credentials, no answer, invalid reply) / Not configured, from this server's breaker. |

## Redis usage budget

Measured on a production build and server with a counting Upstash stub (`APEX_REDIS_SCOPE=quota`, loopback provider cache), 2026-10-31:

| Unit | Before | After |
|---|---|---|
| One `next build` | 383 (and every Jolpica build read failed: lease bug); 13,398 once those reads work | **0** |
| 100 page views (10 key routes × 10) | 1,188 (OpenF1 page read store ≈ 1,060) | **104** |
| One cron run: weather / weekend-watch / rss / youtube / jolpica-nightly | 1 / 1 / 2 / 1 / 15 | same |
| `/api/health` check | 2 (EVAL + PING) | ≤ 1 PING per instance per 5 min |
| Whole quota-stub run (build + pages + crons + 25 admin logins + health) | build failed | **1** command, then the breaker |

Projected month (assumptions: 1,000 dynamic page renders a day, one uptime check a minute, 30 builds): pages ≈ 31,000, crons ≈ 7,800 (rss 2,880, weekend-watch ≈ 2,000, season ≈ 1,800, weather 720, videos ≈ 390), health ≤ 8,640, builds 0: **≈ 48,000 a month** (before: ≈ 356,000 pages + 86,400 health + crons + builds). A race weekend doubling page traffic stays near 80,000, inside the free 500,000. Prefer a separate Upstash database for previews and local runs.

What the table does not cover (review R-09/R-10):
- **Builds**: 0 commands while providers answer. A Jolpica read that fails during the build still asks the shared last-good copy once (one GET per failed key per build worker; capped by the breaker on a spent quota).
- **Cold instances**: the counts are for one warm process. Each new serverless instance starts with an empty process memo: roughly 10-20 extra commands on its first renders. At an assumed 50-100 cold starts a day that is up to about 60,000 a month on top of the projection; still inside the free plan at current traffic.
- **Live hub**: `/api/live/stream` (no UI links to it; realtime is out of scope) runs a distributed hub that reserves and publishes every few seconds while a stream is open: about 1,000-1,500 commands per streamed hour. It is not in the projection; nothing opens it today.

Ceilings guarded by tests (they fail if usage creeps back): a `next build`'s Jolpica reads spend 0 commands (`packages/api-client/src/jolpica/redis-optional.test.ts`); 100 page reads of one Jolpica key on a warm instance ≤ 3; 100 page renders of one OpenF1 query ≤ 7 and a build-time OpenF1 page read 0 (`apps/web/tests/redis-optional.test.ts`); one weather-sync run ≤ 4, a repeat run ≤ 2 (`apps/web/tests/cron-outage-redis.test.ts`). Every process counts its own commands per consumer (`redisCommandStats()`).

## Database

Builds and server starts never change the schema. For a new database, follow [`packages/db/migrations/README.md`](packages/db/migrations/README.md): apply the migrations with an owner role, then create separate least-privileged runtime and worker roles. Use verified TLS. Take and verify a backup before any schema change.

## After a release

- `GET /api/health` on the deployed origin.
- Open the home page, a race page, a driver page and `/legal/privacy` at phone and desktop widths.
- Check the first cron run in the Vercel dashboard and the next scheduled GitHub workflow run.
