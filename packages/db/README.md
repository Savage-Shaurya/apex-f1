# @apex/db

Drizzle ORM and postgres-js schema/helpers for Apex. The current fresh schema has 35 public application tables, including private source observations, job leases, prediction receipts and editorial attribution. Table declarations alone do not establish shipped product interactions.

## Release boundary

The fresh journal and role setup are rehearsed on a disposable PostgreSQL over verified TLS (CI runs this on every push). Existing data requires an independently reviewed catalog/backfill plan; the empty-install baseline is not a shortcut for that reconciliation.

Read [the fresh and legacy migration paths](migrations/README.md) and [security boundaries](security/README.md). New installations have four journaled migrations and the guarded fresh role release. The fourth adds only a nullable constrained newsletter delivery identity; the disposable database applied it after security installation without rerunning roles. Do not run `push` or the empty-install baseline against a populated database. Actual production configuration, recovery rehearsal and managed-hosting integration remain release acceptance.

## Schema groups

| Source tables | Purpose |
|---|---|
| season, circuit, race, session | Calendar and stable session identity |
| driver, team, driver_team_history | Racing participants and associations |
| result, qualifying, sprint_result, pit_stop, lap | Source-entry classifications and timing detail |
| standing_driver, standing_team | Official-round championship snapshots |
| article and article_{tag,driver,team,race}; tag, author, image | Editorial content and relationships |
| video | Provider/asset identity and race/session media links |
| app_user, follow, saved | Identity/state foundation; product server persistence is not complete |
| prediction, prediction_attempt | Signed anonymous game, exact request receipts and versioned background scores |
| event_log, ingestion_run | Operational/event foundation |
| newsletter_edition | Private edition lease, provider intent and delivery-state ledger |
| source_snapshot, source_snapshot_event, job_lease | Ordered local fetch attempts, auditable reconciliation and fenced scheduler ownership |
| editorial_audit | Atomic administrator attribution without article bodies or credentials |

## Connections and helpers

`getDb()` uses the runtime `DATABASE_URL`. Privileged persistence helpers use `getWorkerDb()` and private `DATABASE_WORKER_URL`; deployed jobs fail closed if that connection is absent. Local CLI fixtures may use their explicitly selected worker URL as `DATABASE_URL`. Both connections verify TLS, use bounded singleton pools and set statement, lock and idle-transaction timeouts. Supabase hosts use the bundled reviewed public CA; `DATABASE_SSL_CA_PATH` accepts an absolute operator-reviewed CA path without modifying system trust. `closeDb()` closes both pools. The fresh role release restricts runtime prediction mutation columns, worker grading columns and public publication visibility; roles receive no DDL/TRUNCATE/REFERENCES privileges.

`savePredictionAttempt` atomically stores an actor/race/request receipt with the mutation. Replaying an uncertain response confirms its original outcome without restoring old picks; changed payload or stale expected revision conflicts. Exact PostgreSQL revision text survives microseconds. New writes use the database clock, honor an earlier known active qualifying deadline and reject withdrawn/cancelled/completed races. Calendar and prediction writers share an advisory fence. Signing requires `PREDICTION_COOKIE_SECRET` (at least 32 bytes); browser-safe definitions remain at `@apex/db/prediction-scoring`.

Grading requires a stored complete classification observation, reads at most 501 rows and writes at most 500 participants per transaction. The checkpoint survives cron invocations when the content fingerprint is unchanged. Grade writes retain pick/revision/previous-grade comparisons; public score reads omit grades from obsolete accepted classifications. Content hashes establish equality, **not publisher chronology**. Durable observations reserve before uncached provider reads and fence older overlapping local jobs, including expired scheduler ownership. They cannot prove a publisher's revision order when the provider supplies no revision.

Strict calendar snapshots preserve stable event/session IDs and media links; a different event replacing the same season/round requires reviewed remapping. Omitted optional sessions become unreported, preserve their time/status and never imply cancellation. Date-only changes to another day mark the old precise session time unconfirmed. Explicit cancellation requires official source provenance and an untouched scheduled session. Venue and event source URLs remain separate.

Complete classification snapshots validate all identities before writes and atomically reconcile only source-owned absent entries. Other archives survive; ownership collisions require review. Missing optional constructor/grid/laps remain null, unknown statuses remain explicit, and red-flag pit durations work. A zero-count response cannot erase existing classifications. Standings require official rounds, refuse unreviewed source/round regressions and reconcile source-owned nonempty snapshots. Video verification changes only an explicit fully resolved requested-ID partition and rotates a durable verification cursor; unavailable rows and their media relationships remain stored. See [worker behavior and limits](../../apps/workers/README.md).

Public article readers enforce publication, embargo and nonpremium filters, return real revisions and omit bodies from summaries. Configured failures are unavailable rather than missing content or a successful empty sitemap. Editorial mutations and sanitized actor/publication audit rows commit together. Public sitemap UUID anchors support multiple bounded shards. Premium public access still requires a real entitlement implementation.

Newsletter creation binds a deterministic provider marker and payload hash before external create intent. The identity is immutable within that attempt. A new reservation clears it only in the existing safe failed/no-ID or expired-reserved/no-ID takeover branch; ambiguous intents and known provider IDs remain blocked from automatic replay. Operator recovery reserves a genuine observation before provider readback, uses exact locked edition revision/attempt/state comparisons and appends sanitized named-actor evidence atomically. Confirmed sent evidence can settle a ledger as sent; attach retains uncertain/review state, and no recovery action creates, sends or releases an edition for retry. The backend exposes bounded operator readback, not newsletter bodies or recipients. Actual production provider acceptance remains separate from disposable fixture evidence.

## Outstanding work

Local and CI database checks do not establish production hosting/provider budgets or backup recovery. Historical ambiguous entry/backfill reconciliation, same-lap multiple pit-stop occurrence modeling, unimplemented saved/follow persistence, paid entitlements and distributed live delivery remain explicit boundaries.
