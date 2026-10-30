# Deploying Apex

The short version is in the README's Deploy section. This page lists what each environment needs and the checks to run before and after a release. The full release and recovery procedure is the [release runbook](docs/operations/RELEASE-RUNBOOK.md).

## Before a release

1. From a clean clone: `pnpm install --frozen-lockfile`, then `pnpm typecheck && pnpm test && pnpm lint && pnpm build`.
2. Start the build (`pnpm --filter @apex/web start`) and run `APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate`.
3. `pnpm audit:checked` must report no production advisories.

## Hosting (Vercel)

- Project root directory: `apps/web`. Node 22.
- Environment variables: every name in [`apps/web/.env.example`](apps/web/.env.example). Keep development, preview and production values separate, and keep secrets only in the host's secret store.
- Required in production: `NEXT_PUBLIC_SITE_URL` (canonical HTTPS origin; the build and server stop without it), `CRON_SECRET`, and Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) for shared rate limits and provider quotas.
- Optional services switch on when their variables are set and show an honest "unavailable" state otherwise: news providers, YouTube, Resend newsletter, PostgreSQL (predictions and articles), the admin editor, and PostHog analytics. The cookie banner appears only when an analytics key is configured.
- Crons in `apps/web/vercel.json` call `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`.

## GitHub Actions

- Repository variable `APEX_SITE_URL`: the same origin as `NEXT_PUBLIC_SITE_URL`.
- Secret `CRON_SECRET`: used by the refresh workflows (`refresh-*.yml`) to call the cron routes.
- Database backups (`db-backup.yml`): `SUPABASE_BACKUP_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `SUPABASE_DB_CA_CERT`. Restore steps: [`scripts/ops/restore-db.md`](scripts/ops/restore-db.md).
- CI (`ci.yml`) runs the frozen install, dependency audit, typecheck, lint, tests, build and the quick quality gate with no service credentials.
- CI Lighthouse (`.github/lighthouserc.json`) uses real (devtools) throttling. Performance must be at least 0.70 (owner decision, 2026-10-27: the full-bleed news hero scored 0.71-0.79 on a throttled phone); accessibility 0.95, SEO 0.95, best practices 0.90.

## Cron outcomes and provider outages (2026-10-31)

Jolpica F1 is free and its origin is overloaded on race weekends (uncached reads time out after 60 s; its edge can answer 4xx). The scheduled jobs treat that as a temporary outage, not a failure:

- **Classification** (`classifyProviderFailure`, `packages/api-client/src/transport.ts`): timeouts, dropped connections, 408/425/429, 5xx, and a 4xx whose body is not the provider's own JSON (an edge/HTML or empty page) are `provider-unavailable`. The provider's JSON 4xx (Jolpica answers a bad path with `{"detail":"Bad Request: …"}`) is our request's fault; 401/403, configuration, invalid data and our own exceptions are hard failures. Upstash admission-store failures are labelled `jolpica-admission`, never `jolpica`.
- **Calendar fallback**: `weather-sync` and `weekend-watch` only need the calendar, which barely changes. While Jolpica is unavailable they run on the last validated copy (this process, else the shared `…:last-good:` copy in Upstash) up to 7 days old, and their 200 report says `degraded: true`, `results.calendar: { source: "last-good", storedAt }`.
- **Contract**: when work is deferred only because a provider is unavailable, a cron route answers **HTTP 503** with `Retry-After: 120` and `{ ok: false, route, retryable: true, reason: "provider-unavailable", provider, error, lastSuccessAt }`. `lastSuccessAt` (ISO or `null`) is the route's last ok report, kept per route in Upstash (`apex:cron:v1:last-success:<route>`, environment-scoped like every other key, 30 days) and in the serving process. Every other failure keeps HTTP 500 (or 401/503 for auth/lease problems) and never carries `retryable`.
- **Workflows** (`scripts/invoke-cron.mjs`): a provider-unavailable report, 502/504 or a dropped connection is retried after 30 s and 90 s (three attempts, inside an 8-minute run budget). If the provider is still unavailable the run ends **green with a `::warning::`** and a job-summary line while `lastSuccessAt` is within 48 h (`weather-sync`, `weekend-watch`, `rss-sync`, `youtube-sync`) or 72 h (`jolpica-nightly`), and **red** once it is older or unknown (`null`, e.g. Upstash unset or no success yet). Any other error fails red at once. The invoker accepts `http://localhost`/`127.0.0.1` for local checks; `APEX_CRON_RETRY_DELAYS_SECONDS` (e.g. `5,10`) shortens the waits for a local simulation.

## Redis key scope and provider budgets (audit F-07, F-02, F-01)

- Every shared budget, quota, backoff and cache key in Upstash is scoped by environment (`packages/api-client/src/redis-scope.ts`). Only the production deployment (`VERCEL_ENV=production`, or `APEX_ENV=production` on a self-hosted production server without `VERCEL_ENV`) uses the unscoped production keys (`apex:jolpica:v1:{jolpica}:quota`, `apex:live:v1:{openf1}:…`, `apex:rl:v1:…`, `apex:openf1:v1:last-good:…`, `apex:weekend-watch:v1:…`). Previews use `apex:preview:…`, local runs `apex:local:…`; `APEX_REDIS_SCOPE=<label>` isolates one worktree, agent or CI job (`apex:local-<label>:…`). Admin session keys are not scoped.
- A local or CI process started with `production.env` therefore never spends or pauses the live site's Jolpica/OpenF1 budget. Prefer a separate Upstash database for non-production anyway, and route local builds through the loopback provider cache (`JOLPICA_BASE_URL`/`OPENF1_BASE_URL` with `APEX_ALLOW_LOCAL_PROVIDER_CACHE=1`).
- A Jolpica 429 pauses only its endpoint class (standings, results, schedule, drivers, …) for its `Retry-After` (default 15 s, at most 120 s), in this instance and through the shared backoff key. Reads in a paused class wait when the pause ends inside their budget; otherwise they answer from the process cache or the shared last-good copy (`…:last-good:` keys, 6 h for live data, any age for completed seasons) before a page shows an outage.
- `next build` never fails because a provider is slow or rate-limited: build reads may queue for 90 s on top of their transport timeout and retry with backoff, every build worker shares one per-build store of validated responses, paths whose data cannot be read are left out of the prebuild (they render on first visit), and a page that still meets an outage while prerendering is served with its honest unavailable state for 60 s, then ISR regenerates it. The route stays ISR (never `ƒ` because of provider weather).

## Database

Builds and server starts never change the schema. For a new database, follow [`packages/db/migrations/README.md`](packages/db/migrations/README.md): apply the migrations with an owner role, then create separate least-privileged runtime and worker roles. Use verified TLS. Take and verify a backup before any schema change.

## After a release

- `GET /api/health` on the deployed origin.
- Open the home page, a race page, a driver page and `/legal/privacy` at phone and desktop widths.
- Check the first cron run in the Vercel dashboard and the next scheduled GitHub workflow run.
