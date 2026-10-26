# Apex

Apex is an independent, unofficial Formula 1 fan site: the season calendar with session times in your own time zone, race results and championship standings back to 1950, driver and team profiles, F1-only news from named publishers, videos, a newsletter and a free race-predictions game. Everything shown comes from real public data; when a source is down, the page says so instead of showing made-up numbers.

Apex is not affiliated with Formula 1, the FIA, Formula One Management or any team.

## Stack

| Layer | What it uses |
|---|---|
| Web app | Next.js 16 (App Router, Turbopack), React 19, strict TypeScript |
| Styling and motion | Tailwind CSS v4, Motion (framer-motion), GSAP + Lenis on one clock, React Three Fiber (lazy, with static fallbacks) |
| Data | Jolpica (Ergast-compatible results archive), OpenF1 (final session timing), Wikipedia, Wikidata and Wikimedia Commons, publisher news APIs and feeds, YouTube Data API, Open-Meteo |
| Storage | PostgreSQL via Drizzle ORM (predictions, articles, newsletter ledger), Upstash Redis (shared rate limits and provider quotas) |
| Email | Resend (newsletter) |
| Monorepo | pnpm 10 workspaces + Turborepo, Node 22+ |
| Hosting | Vercel (web app and daily crons), GitHub Actions (schedules, CI, database backups) |

| Path | Purpose |
|---|---|
| `apps/web` | The Next.js site: pages, API routes, admin article editor, tests and the browser quality gate |
| `apps/workers` | Command-line ingestion jobs (Jolpica history and nightly sync, YouTube sync, OpenF1 diagnostic) |
| `packages/api-client` | Provider clients: transport, validation, mapping, quotas and the F1-only news policy |
| `packages/db` | Drizzle schema, migrations, database roles and TLS setup |
| `packages/types`, `packages/ui` | Shared types and design tokens |
| `scripts` | Test runner, dependency audit, cron invoker, backup and release tooling |
| `docs` | [Quality gate](docs/QUALITY-GATE.md), [news policy](docs/NEWS-POLICY.md), [admin authentication](docs/ADMIN-AUTHENTICATION.md), [release runbook](docs/operations/RELEASE-RUNBOOK.md) |

## Local setup

You need Node 22 or later and pnpm 10.33.0 (`corepack enable` picks the pinned version from `package.json`).

```sh
git clone <this repository> apex && cd apex
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local   # then fill in what you need
pnpm dev                                       # http://localhost:3000
```

[`apps/web/.env.example`](apps/web/.env.example) lists every variable with a one-line explanation. None is needed to start the site locally: results, standings, schedules and profiles use free public APIs, and every optional service (news keys, newsletter, predictions database, Redis, analytics) reports itself as unavailable until configured. Never commit `.env.local` or any real key.

Useful local options:

- `JOLPICA_BASE_URL` / `OPENF1_BASE_URL` can point at a local cache (`node scripts/dev/provider-cache.mjs`) so several dev servers share one provider budget.
- `APEX_NEXT_DIST_DIR=.next-<name>` builds into a separate folder, so a second build does not disturb a running one.
- Prediction writes need `DATABASE_URL` and `PREDICTION_COOKIE_SECRET`. Use a local PostgreSQL for write tests; see [`packages/db/README.md`](packages/db/README.md).

## Scripts

Run from the repository root.

| Command | What it does |
|---|---|
| `pnpm dev` | Starts the web app (and any package watchers) |
| `pnpm build` | Production build of every workspace |
| `pnpm typecheck` | Generates Next route types, then strict TypeScript checks for every workspace |
| `pnpm test` | All behaviour tests (`*.test.*` in `apps`, `packages` and `scripts`) with Node's test runner |
| `pnpm lint` | ESLint |
| `pnpm audit:checked` | Dependency audit: production must be clean; reviewed development exceptions expire |
| `pnpm qa:gate` / `pnpm qa:gate:quick` | Browser quality gate against a running site (see below) |
| `pnpm --filter @apex/workers jolpica:nightly` | Example worker job (needs `DATABASE_WORKER_URL`) |

## Quality gate

A change is done when all of these pass:

```sh
pnpm typecheck && pnpm test && pnpm lint && pnpm build
APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate:quick
```

The quality gate drives a real Chromium browser over every route group at phone, tablet and desktop widths: overflow and clipped text, broken or badly cropped images, accessibility (axe, WCAG 2.2 AA), keyboard flows, data checked against Jolpica, and an internal link crawl. `pnpm qa:gate` runs everything; CI runs the quick set on every push and pull request. Details and how to add a check: [docs/QUALITY-GATE.md](docs/QUALITY-GATE.md).

## Deploy

1. Create a Vercel project with root directory `apps/web` (framework: Next.js). The install and build commands come from the workspace.
2. Add the environment variables from `apps/web/.env.example` in the Vercel project settings. `NEXT_PUBLIC_SITE_URL` (the public HTTPS origin) is required in production; the build stops without it.
3. Daily crons are declared in `apps/web/vercel.json` and authenticate with `CRON_SECRET`.
4. In GitHub, set the repository variable `APEX_SITE_URL` (same origin) and the secret `CRON_SECRET` for the refresh workflows in `.github/workflows`. Database backups (`db-backup.yml`) also need `SUPABASE_BACKUP_DB_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
5. For a database, apply the migrations and roles in `packages/db/migrations` before enabling predictions or the article editor. Builds never run migrations.

More detail, including release checks and recovery, is in [DEPLOY.md](DEPLOY.md) and the [release runbook](docs/operations/RELEASE-RUNBOOK.md).

## Content and credits

News headlines link to the original publisher, videos are embedded from YouTube, Formula 1 images are credited, and Wikimedia Commons photos carry their author and licence on the [`/references`](apps/web/app/references/page.tsx) page. Commons photos are delivered from the site's own origin, so visitors' browsers never contact Wikimedia.
