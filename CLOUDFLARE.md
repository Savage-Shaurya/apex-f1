# Apex on Cloudflare Workers (since 11 Nov 2026)

Vercel disabled the apex-f1 project (HTTP 402). Apex now runs at **https://apex.snappycrew.com**
(Worker `apex-f1`, Cloudflare account of snappycrew.com, Workers Free plan). The old
apex-f1-self.vercel.app link cannot be redirected.

## Deploy

```bash
cd apps/web
NEXT_PUBLIC_SITE_URL=https://apex.snappycrew.com APEX_HOST=cloudflare pnpm cf:deploy
```

`cf:deploy` = `opennextjs-cloudflare build` + `scripts/cf-fetch-shards.mjs` + `opennextjs-cloudflare deploy`.
Rollback: `npx wrangler versions list` then `npx wrangler rollback <id>`. Logs: `npx wrangler tail apex-f1`.

A build reads Jolpica hard; if it answers 429 the affected prerenders ship their honest
"unavailable" state and regenerate at runtime. Avoid two builds within an hour.

## What runs where

| Piece | Cloudflare |
|---|---|
| Next.js 16.4.6 app | OpenNext 1.20.16, entry `apps/web/cf-worker.ts` |
| ISR pages + fetch data cache | `open-next.config.ts`: isolate memory, then Cache API (pages), then the build copy in static assets (fetch entries in 16 shards). No KV: the Free plan allows 1,000 KV writes a day for the whole account |
| Tag cache | none (each lookup would cost a subrequest; Free plan = 50 per request). `revalidateTag` only clears the local isolate; pages refresh on their own `revalidate` times |
| Time-based ISR refresh | Durable Object `DOQueueHandler` |
| Vercel crons (jolpica-nightly 03:00, youtube-sync 04:00, newsletter-blast Fri 06:00 UTC) | Cron Triggers in `wrangler.jsonc`, run by `cf-worker.ts` with `Bearer CRON_SECRET` |
| Other refresh jobs | GitHub Actions as before; repo variable `APEX_SITE_URL=https://apex.snappycrew.com`, secret `CRON_SECRET` (same value as the Worker) |
| `redirect: 'error'` fetches | `cf-fetch-shim.ts` (Workers only accept follow/manual) |
| Client IP for rate limits | `CF-Connecting-IP` when `APEX_HOST=cloudflare` (`lib/rate-limit.ts`) |
| Redis key scope | `APEX_ENV=production` (no `VERCEL_ENV` on Cloudflare) |
| Framing | unchanged `next.config.ts`: public pages `frame-ancestors 'self' https://snappycrew.com https://www.snappycrew.com`; `/admin*`, `/api/admin/*` DENY + `'none'` |
| `*.workers.dev` copy | `X-Robots-Tag: noindex` |

## Worker secrets (names only)

Set 11 Nov: `CRON_SECRET` (new), `PREDICTION_COOKIE_SECRET` (new), `ADMIN_SESSION_SECRET` (new),
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (the Upstash free quota is used up for this month,
so Redis reads as down and everything runs on the per-isolate fallbacks).

Not set (Vercel returns only `[SENSITIVE]` placeholders; values live in the owner's key files):
`DATABASE_URL`, `DATABASE_WORKER_URL`, `ADMIN_USERS_JSON`, `ADMIN_MFA_SECRETS_JSON`,
`NEWSAPI_KEY`, `GUARDIAN_API_KEY`, `NEWSDATA_API_KEY`, `GNEWS_API_KEY`, `CURRENTS_API_KEY`, `YOUTUBE_API_KEY`.
Without them predictions/articles, admin sign-in, the keyed news sources and YouTube sync show their
honest unavailable states (RSS news and Jolpica data work). Set each with
`npx wrangler secret put <NAME>` in `apps/web`.

Unused resources made during the move (kept): KV namespace `apex-cache` (ee608fa7...), D1 `apex-tag-cache`.
