# Release and recovery operations

This runbook describes how to prepare and recover an Apex release. Local checks and real hosted acceptance are separate gates. Never run migrations, restores or write tests against a database you were not explicitly given for that purpose. The application uses Drizzle with PostgreSQL; startup/build never applies migrations.

## Produce a reviewable release

1. Freeze the final application source. Run `node scripts/ops/export-release.mjs <new-directory>` using a **new directory outside the checkout**.
2. Export again into a second new directory. Their `RELEASE-MANIFEST.json` digests must agree. The digest binds sorted relative paths, byte counts and SHA-256 hashes. Export preserves source bytes and does not use or repair damaged local Git metadata.
3. Run `node scripts/ops/release-preflight.mjs --source-only --manifest` from the export. This verifies all source hashes, rejects linked/escaping/unlisted files and incomplete exports, and checks the five reviewed schedules. It contacts no providers.
4. Put the reviewed export in a separately created clean repository with a fresh history (`git init`); never push the private development history, which still contains internal material. Review source before committing; these helpers never push, merge or deploy.
5. Use Node 22 or later and root-pinned pnpm 10.33.0. Perform a frozen installation, type checks, lint, tests, checked dependency audit and fresh build. Never deploy a local acceptance `.next` output.

The allowlist covers both applications, four packages, patches, scripts, reviewed workflows, root package/build configuration and operations/admin documentation. It excludes **every `.env` file except the blank, value-free `apps/web/.env.example` template**, root agent guidance (`CLAUDE.md`), named secret drop files, `.private`, dependencies/caches/builds, local hosting/Git metadata, audit reports, native migration fixtures and the acceptance runner. The blank [configuration field inventory](release-config.example.json) is included. Unit tests remain included for clean-repository regression checks. Export and manifest validation also reject recognizable provider tokens and private-key headers; redacted findings contain only relative path/category, with no test-file exemption. These narrow patterns are not arbitrary secret discovery; retain a real repository secret scan before release.

## Configuration and authentication

Provision values through the target hosting secret store, never the exported example. Keep development, staging and production credentials separate. Run `node scripts/ops/release-preflight.mjs` in the real target environment after values are privately present. It imports the application's current production security validator and prints fixed field diagnostics. It always reports `serviceConnectionsVerified:false`: configuration shape does not prove provider access, database grants, sender verification or delivery.

The external-deployment policy refuses inherited Node preloads/options, disabled TLS, acceptance build folders, loopback/disposable service URLs and test site origins. Self-hosted loopback deployments need a separately reviewed policy; do not reuse local fixture configuration.

Configure `ADMIN_USERS_JSON` with named fixed-format scrypt hashes and explicit capabilities, `ADMIN_MFA_SECRETS_JSON` with a unique exact 32-character uppercase Base32 second factor for each identity, and `ADMIN_SESSION_SECRET` with a private random canonical base64url signing secret. Production legacy `ADMIN_PASSWORD` is forbidden; `ADMIN_LOCAL_DEV_BYPASS` remains false. Follow the [administration guide](../ADMIN-AUTHENTICATION.md) for enrollment, rotation and second-factor recovery. Shared Redis is mandatory. Verify HTTPS login, idle/absolute expiry, logout, password/capability changes, factor reuse rejection and Redis failure in the actual target before granting operational access.

Use distinct least-privileged runtime/worker database identities; keep the migration owner out of application configuration. TLS certificate and hostname validation remain enabled. Privately provision an absolute trusted CA path if required. Export includes no disposable CA or credentials.

## Schema cutover

For an empty new database, follow [the four-entry Drizzle journal and fresh role instructions](../../packages/db/migrations/README.md), then verify hashes, catalog, RLS and effective privileges. Provision roles privately first; fresh security release refuses an already secured/unknown schema. A populated legacy database needs its reviewed manual expansion/reconciliation/finalization plan. Never invent migration history by marking a fresh baseline applied to existing data.

Verify a backup before cutover. Quiesce conflicting ingestion/scoring writers, check migration preconditions and deploy matching code after catalog checks. Automatic destructive rollback that loses source identities, prediction receipts or newsletter history is not acceptable recovery.

## Five scheduled jobs

| Job | Owner | Declared cadence (UTC) |
|---|---|---|
| Racing calendar/results | Hosting cron | 03:00 daily |
| Videos | Hosting cron | 04:00 daily |
| Newsletter edition | Hosting cron | 06:00 Friday |
| News cache | Repository workflow | Every 30 minutes (:02 and :32) |
| Weather | Repository workflow | Hourly at minute 17 |

Hosting schedules are in `apps/web/vercel.json`. Repository workflows require private `CRON_SECRET` and the correct `APEX_SITE_URL` HTTPS origin, which must equal the deployment's `NEXT_PUBLIC_SITE_URL` (the only source of the canonical origin in the app; a production build or start without a real HTTPS value fails). Every route authenticates the bearer secret; caller cron headers grant no access. Native leases fence competing owners, but a timed-out call may already have committed. Do not automatically replay newsletters or infer nonexecution from a lost response.

`node scripts/ops/verify-scheduler.mjs` verifies exact reviewed repository workflow bytes, hosting paths/cadences and heuristic route authentication wiring. Every changed workflow step/schedule/permission requires review and a new recorded hash. `scripts/invoke-cron.mjs` issues one explicitly selected, bounded news/weather request, rejects redirects/malformed reports and never retries. Real email tests require the target delivery plan. Verify hosted run history, reports, alerts, leases and quotas separately; prepared schedules are not proof remote jobs ran.

## Disposable restoration rehearsal

`scripts/ops/backup-restore-drill.mjs` is **not a production backup tool**. It requires a root-issued disposable window, exact `127.0.0.1:55432/apex_disposable` owner URL, verified trusted CA and reviewed run ID. It reads a consistent exported PostgreSQL snapshot and never resets, migrates or writes to that source.

The helper creates one random `apex_restore_20261004_<16 hex characters>` database only after proving absence; it records the exact ownership target before creation. Native dump/restore preserve owners and ACLs. Commands require verified TLS, do not place passwords in arguments, strip inherited PostgreSQL overrides, have finite deadlines and withhold private diagnostics. The archive remains inside `.private`, excluded from release: Windows access is current-user/SYSTEM-only and Unix directories are mode 0700.

Restoration compares table/migration row SHA-256 digests, sequences, columns/defaults, indexes, constraints, triggers, enums, routines, owners, ACLs, RLS flags/policies, memberships and effective table/column/sequence/schema/database/function privileges. A separate source-after fingerprint must equal the baseline. The helper closes pools and drops **only its exact newly created restore DB**; active sessions prevent forced termination/deletion. Safe failure reports and the ownership manifest retain any uncertain target for inspection. Never perform broad cleanup or drop the source.

Roles are reused in the same cluster. This does **not** prove recovery of a lost cluster's users, password secrets, cloud configuration, encryption keys, external delivery state or Redis sessions. Rehearse those separately, including role provisioning without exposing password hashes, key/CA recovery, session revocation, provider readback and deployment restoration. Preserve authoritative newsletter/source/receipt history: an empty recreated ledger can cause duplicate sends or lose uncertain attempts. Measure actual recovery-time/recovery-point targets in staging.

### Completed independent local recovery

The October 7 local rehearsal initialized a genuinely separate PostgreSQL cluster on another loopback port and verified different native system identifiers. It reconstructed the four explicitly captured Apex roles with **new private passwords**, retaining owner/ACL/policy restoration without exporting source password hashes. All four actual verified-TLS logins succeeded; all four wrong-password attempts were rejected. Runtime, worker and public roles remained NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOBYPASSRLS. Unexpected role memberships or role/database settings stopped the recovery plan rather than being omitted.

Native recovery matched 35 public tables, 166 public rows, four migration rows, 90 policies and 4,971 effective privilege comparisons. It additionally checked role limits/expiry, touching membership edges, full sequence definitions and OWNED BY dependencies, extensions, tablespaces and database locale/properties. Default tablespace and inherited `plpgsql` ownership were deliberately recovered **only in that new destination**; ownership differences were recorded before correction. Nineteen real forbidden operations and separate public/editorial/worker article, association and video-policy canaries passed. Prediction policies remain service-wide; backend logic enforces per-fan isolation.

Exact canary cleanup restored the target fingerprint, the source remained read-only with its unchanged native fingerprint, and only the exact newly owned target database was dropped after name/OID/owner/nonce/system-identifier and zero-session checks. The runtime owner stopped the separately owned destination cluster and retained its directory/private archive. Measured dump/reconstruction/restore/probe time was 4.390 seconds for the small local dataset, excluding cluster/TLS initialization. This closes local cross-cluster role recovery; it does not certify hosted backup retention, Redis/external-state recovery, cloud/secret-manager restoration or production RTO/RPO. Retain the separate audit evidence and rehearse the actual hosted recovery procedure before cutover.

## Automation and final acceptance

The operations-integrity workflow performs frozen installation, boundary tests, scheduler source checks, two deterministic exports and exact manifest comparison. It receives no deployment/provider/database credentials and invokes no mutation routes. Existing CI retains complete application checks and the dated dependency policy. Source integrity does not establish hosted execution.

## Archive cold/warm release gate

After the reviewed build is deployed, run the explicit readiness command for each addressed serving instance:

```sh
node scripts/prewarm-championships.mjs --origin https://INSTANCE_ORIGIN
```

On a successful run it makes four sequential real GETs: initial and warm driver archive, then initial and warm constructor archive. It fails immediately if an initial archive is partial/unavailable; four completed reads are not guaranteed under slow cold-provider conditions. The command accepts one HTTPS origin, or loopback HTTP for authorized local work, without credentials/path/query/fragment. It never retries or follows redirects, refuses unexpected cookies, bounds each request to 40 seconds, the entire run to 100 seconds and response bodies to 8 MiB. Both warm **complete streamed bodies** must finish within two seconds, contain every completed-season record and retain stable year/name/points digests. For a 2026 run that is 76 driver seasons and 68 constructor seasons. An HTTP 200 or loading shell is insufficient; partial, unavailable or invalid archives fail readiness. This command issues real route reads when explicitly run and is not an offline fixture or a provider-acceptance substitute.

The shared archive cache retains only validated complete aggregates for seven days, measured from the oldest original source observation. A single fenced fill lock serializes both championship kinds globally. Default Jolpica transports and retries share Redis TIME admission at 260 ms spacing and 500 calls/hour; do not multiply these budgets by replica count or start a replica warmup herd. Shared Redis failure does not authorize an independent competing provider fallback. A genuinely empty archive still requires its physical historical requests: the 2026 aggregate covers 144 season lookups. Shared cache hits and addressed-instance readiness are separate measurements.

The web's 30-second archive deadline remains bounded. Slow cold upstream responses can prevent one request from finishing the entire history. Strictly verified internal per-season progress checkpoints, written every eight years and at a bounded final checkpoint, preserve original observation timestamps and the seven-day ceiling under the global fence and correction epoch. Progress is never presented as a complete public archive. A later **explicit**, bounded operator/client invocation can resume missing years; complete publication atomically removes progress. Review the reported state before choosing to rerun the readiness command. There is no automatic retry or perpetual warmer. Successful dispatch release retains global quota/start pacing; a timeout or unknown failure retains the 35-second dispatch guard.

The two championship routes read dynamically instead of relying on per-replica HTML ISR. Historical worker/index corrections advance the relevant kind's shared epoch; old fill owners cannot publish through a changed epoch. After a historical correction, verify that every serving instance reads the new epoch and exposes corrected rows. Confirm the target Redis is shared across the intended instances/regions and that lock fencing, expiry, quota enforcement and invalidation behave in that actual hosting topology. Serialize explicit instance readiness runs; one request through a load balancer cannot prove every replica is ready.

Keep cold full-body time, shared-hit time and subsequent warm full-body time separate. The earlier local true-cold HTTP measurements were 20.310 seconds for driver history and 17.914 seconds for constructor history. A first cold fill remains expensive; the shared upgrade prevents redundant fills and enables controlled readiness before traffic, without claiming those earlier measurements establish its new hosted latency. Perform readiness against championship routes only; never trigger newsletters or consume live telemetry quota for an archive warmup. Neither streamed headers nor backend warm latency establishes frontend rendered FPS.

Production requires clean source/fresh build, real private staging configuration, TLS/grant checks, verified restoration, actual provider entitlement and newsletter delivery/unsubscribe checks, HTTPS administrator acceptance and hosted scheduler/CI/deployment evidence. Frontend design, responsive text/image visibility, accessibility, device behavior and physically measured 120 FPS remain separate user-owned acceptance. Warm fixture latency and successful builds cannot close those gates.

Provide the remaining target inputs privately: a separate staging hosting project and HTTPS origin; staging database with trusted CA and distinct owner/runtime/worker/public identities; shared staging Redis; verified email sender/audience and a human-owned test inbox; actual media/provider entitlements and allowed API keys; hosted CI/scheduler access; backup-retention and secret/CA recovery settings; and physical-device/high-refresh-display access. Do not paste credentials into chat or reuse a database that was not provisioned for this environment. Local completion records do not assert that these real services have been exercised.
