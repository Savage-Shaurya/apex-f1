# @apex/workers

Node CLI ingestion and provider diagnostics. These scripts require an operator/scheduler to run them; frequency below is intended cadence, not proof of a deployed job. The web Vercel cron and the shared SSE server hub are separate entry points.

| Script | Intended cadence | Actual behavior | Required configuration |
|---|---|---|---|
| `jolpica:historical` | Reviewed backfill/incremental rerun | Strict paginated seasons and identities; atomic calendar/classification snapshots and available detail; fails on unresolved/ambiguous entries | Dedicated database worker role; reviewed schema/backfill; optional `--since`/`--until` |
| `jolpica:nightly` | Daily | Stable calendar, official-round standings, rotating classification reconciliation and resumable prediction grading | Dedicated database worker role; reviewed schema |
| `openf1:diagnostic` | Explicit diagnostic only | One strict, paced snapshot of at most two minutes; at most five requests and a 35-second overall deadline | Provider access where required; no database or Redis writes |
| `youtube:nightly` | Daily | Latest curated uploads plus rotating verification of stored videos; targeted public/unavailable reconciliation | Dedicated database worker role; YouTube Data API key |

Run ingestion only against a database you own and have migrated. For write tests, use synthetic records in a new isolated local PostgreSQL.

## Database release and connections

Review `packages/db/migrations/README.md` and the staged SQL before deploying source requiring its new keys/columns. A missing `DATABASE_URL` or persistence error fails a worker; it is not reported as a successful zero-row sync.

The database client uses verified TLS with a scoped public Supabase CA for Supabase hosts. `DATABASE_SSL_CA_PATH`, when configured, must be an absolute operator-owned path to the expected certificate bundle. Jobs use `DATABASE_WORKER_URL`; deployed environments reject a missing dedicated worker connection. The application pool is bounded to one connection per process, with connection, statement, lock and transaction timeouts. CLI jobs close the pool after completion. Production readers, application mutations, workers and migrations use separate database roles.

## Stable identities and corrections

Calendar sessions update by `(race_id, kind)` and retain IDs, media links, actual times and OpenF1 references. Missing/date-only schedule times do not overwrite precise session timestamps. An omitted optional session is marked unreported and preserved, rather than treated as cancelled. Cancellation requires explicit trusted evidence. A past calendar timestamp alone does not prove a completed classification.

Results use `(source, source_entry_id)`. The local historical archive contains multiple legitimate entries for some drivers in one race. Jolpica does not expose the archive row ID: its single-entry driver key is accepted only for unambiguous races. Repeated driver entries stop ingestion until a reviewed archive-ID mapping exists; no ordinal, row hash, random default or silent skip is used. Result/qualifying/sprint/lap/pit-stop corrections update established rows.

Both YouTube entry points share one reconciliation pipeline, preserving case-sensitive `(provider, provider_asset_id)` identities, editorial slugs and race/session associations. Up to 100 previously stored IDs outside the current upload window are verified each run, with a durable rotating cursor. Only an entirely successful, validated details response may mark requested absent/private/unlisted videos unavailable; rows and associations are retained. A verified public response restores availability. Failed responses and unknown privacy states preserve existing rows and the cursor. Standings retain their official upstream snapshot round; no round-zero or final-schedule-round substitution occurs.

## Quotas, grading and operational limits

Historical Jolpica requests are sequential and paced within the worker, including every pagination page and retry. The default/minimum interval is 8 seconds (at most 450 requests/hour before latency). `JOLPICA_DELAY_MS` may increase this. This pacing does not establish a shared quota across unrelated clients. Full history is a long operation; there is no measured completion-time guarantee. Each collection has a bounded deadline. Optional full lap ingestion remains gated by `INGEST_LAPS=1`; a deadline failure preserves the previous atomic classification for review/rerun.

Prediction grades are written only by background entry points, after complete pole, podium and fastest-lap evidence. Each page contains at most 500 participants, and a durable cursor resumes work after a bounded run. Scores carry a canonical source hash; corrected classifications can regrade unchanged picks. Timestamp and JSON optimistic checks prevent an older snapshot from grading an edited submission. Signed-cookie identity requires `PREDICTION_COOKIE_SECRET`; unsigned legacy IDs are deliberately rejected.

CLI and web cron entry points share durable database job leases. Each lease renews during a finite run; overlap skips work, and lost ownership or a deadline causes failure. Daily CLI jobs have a 15-minute overall budget, historical operator jobs 12 hours, and an explicit code-level override is capped at 24 hours. Large backfills should use reviewed season ranges and rerun after a bounded failure. A source observation is allocated before provider reads, and its exact generation, expiry and job ownership fence the resulting database transaction. A content hash detects corrections; it does not establish provider chronology. `runWorker` records ingestion start, success/failure and counts. Web cron has a 45-second work budget within a 60-second route limit.

The OpenF1 diagnostic outputs a bounded JSON summary and does not create an ingestion run. Production SSE uses a separate distributed web publisher/consumer with shared Redis ownership and provider admission. Static page snapshot reads remain outside that live admission budget. Missing shared storage in a deployed environment is explicitly unavailable; local process fallback is not distributed proof. Native disposable PostgreSQL and Redis evidence, configured hosted-provider behavior, hosting time limits and production monitoring are distinct release checks.
