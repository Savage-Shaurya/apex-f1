# Fresh installation and existing database upgrades

The October 4 release includes an actual **empty-database Drizzle baseline, snapshots and journal**: `0000_fresh_application_schema.sql`, `0001_observed_provider_compatibility.sql`, `0002_lifecycle_and_payload_constraints.sql` and `0003_newsletter_delivery_identity.sql`. They define 35 tables and the matching final helper schema. Native PostgreSQL 18.6 rehearsed the first three journal entries on a new disposable database, then applied the fourth additive identity migration to that secured instance after verifying its existing migration hashes. A native first attempt caught the generated composite foreign-key ordering defect; the baseline now creates the race season/round unique index before its referencing keys. The original failure is retained in release evidence.

`0003` adds nullable `newsletter_edition.delivery_identity` and a CHECK for the exact version/provider-name/payload-hash shape. Existing rows remain null, so previously ambiguous editions are not assigned invented provider identity. The runtime/public ledger denial and worker append-only source-audit grants remain unchanged. Native application used the narrowly guarded outer `backend-release-20261004/database/apply-native-newsletter-identity.mts`, not a bootstrap or role rerun. Recovery must bind the identity to the actual edition and provider readback in trusted server logic; a well-shaped hash alone is not proof of delivery.

For a new empty database, provision migration-owner and separate NOINHERIT/non-owner/non-BYPASSRLS roles privately, apply the complete Drizzle journal with the migration owner, then apply [the guarded fresh role release](../security/0005_fresh_runtime_roles.sql). Roles are `apex_runtime`, `apex_worker` and `apex_public`; no password is embedded in SQL. `packages/db/scripts/bootstrap-disposable.mjs` is restricted to the authorized loopback disposable fixture. Production provisioning must use its separately reviewed environment and backup/recovery controls. The fresh security release rejects unreviewed managed-template browser/default grants rather than assuming a Supabase authentication model.

The files in `manual/` remain **an upgrade plan for the inspected legacy database**. They were authored locally and tested on separate synthetic fixtures; they were not applied to the supplied database. Their reviewed backfills remain necessary for existing data. **Do not run the new empty-install baseline against an existing populated database or mark it applied to invent a migration history.** `drizzle-kit migrate` is not the release mechanism for these legacy manual stages. Keep their data mapping and catalog reconciliation separate from the new installation journal. The supplied database remains untouched.

The source schema describes the **final state**. Expansion leaves legacy result identities nullable and retains the old result key; finalization installs the stable session key and prediction constraints and replaces result identity. Deploy code requiring final-state columns/keys only after the corresponding stage and validation. A source typecheck does not prove database readiness.

## Catalog assumptions and change scope

The sanitized read-only catalog in `audit/2026-09-30/database-live-readonly.json` records an existing standalone unique index named `public.result_race_driver_unique` on `(race_id, driver_id)`, existing unique race season/round and prediction cookie/season/round indexes, and no session race-kind unique index. It records RLS enabled on the 29 original tables, and a connection role owning them with BYPASSRLS. The deployment-to-database mapping was not independently confirmed. It contains no column inventory or application-row counts, so neither data readiness nor exact column compatibility is inferred from it.

Each SQL stage has its own explicit session setting guard, `BEGIN`/`COMMIT`, bounded lock/statement timeout and one-time state preflight. An ordinary paste without the selected release setting fails before DDL. The expansion script refuses an unexpected legacy result index or preexisting newsletter ledger. Finalization locks row writers between its preflight and constraints. Failure aborts the transaction; inspect and reconcile the cause instead of weakening checks.

## Stage 1 — additive expansion

1. Verify the intended environment, current catalog, backup/restore procedure and code release sequence. Review the SQL as the table-owning migration role.
2. On that same connection, explicitly select `apex.schema_hardening_release = '2026-09-30-expand'`, then execute the complete `manual/20260930_01_expand.sql` transaction. The setting is deliberately not selected by the script itself.
3. Verify the added nullable `result.source`/`result.source_entry_id` columns, source-pair unique index, nullable prediction score version, and private newsletter ledger. Check denied anon/authenticated ledger access through effective privileges and policies; do not assume direct revocations remove inherited grants.

Expansion does not rewrite, deduplicate or delete any application rows. It **retains** legacy race-driver uniqueness, so historical multi-entry ingestion cannot be enabled yet. The new source-pair index permits only legacy null pairs or nonempty complete pairs. The ledger enables RLS and revokes PUBLIC, anon and authenticated direct grants in its creation transaction. If `apex_app` exists, it receives only SELECT/INSERT/UPDATE on this table and an explicit service policy; no ledger DELETE/DDL rights are granted here. Current owner-based workers can still access it through normal owner privileges.

## Before finalization — reviewed data reconciliation

### Result identity and archive backfill

Use an authoritative provider identity for each **entry**, not a single driver/race record. The supplied results archive has its own stable result ID; preserve that under a stable source namespace when importing it. The parent database audit measured 85 repeated race-driver groups and 91 excess distinct records in that archive. Rows for one driver can differ in constructor, laps or classification status; they must not be discarded or overwritten.

Build an auditable mapping from each current result row ID to its exact authoritative source entry. Preserve row IDs and existing references. Investigate ambiguous matches; do not use a row's random UUID, a made-up ordinal, or an entire mutable-row hash as evidence of an authoritative identity. A correction changes mutable fields while preserving entry identity. If a provider omits an ID, document a stable namespace/entry discriminator and test its collisions and correction behavior against historical cases before use.

The scripts intentionally contain **no automated backfill UPDATE or DELETE**. A separately reviewed/import-tested backfill is required. Record current row counts, mapped counts, ambiguous matches, collision counts and rows expected to be restored from the archive. Backfill existing entries while the old key is retained. After finalization removes that key, a controlled source import can restore previously omitted legitimate entries using the new source identity, with source/stored count reconciliation.

Readiness queries include:

```sql
SELECT count(*) AS missing_source_identity FROM public.result
WHERE source IS NULL OR source_entry_id IS NULL
   OR length(btrim(source)) = 0 OR length(btrim(source_entry_id)) = 0;

SELECT source, source_entry_id, count(*) FROM public.result
GROUP BY source, source_entry_id HAVING count(*) > 1;
```

Both must be clear before finalization. Those tests alone do not prove the source mapping is correct: review the mapping evidence too.

### Stable sessions

The current schedule model has one canonical FP1/FP2/FP3/SQ/S/Q/R session per weekend kind. Confirm that this covers the target product's actual occurrences. If repeated kinds represent real distinct sessions, introduce a separate occurrence key and revise this plan before running it; a uniqueness constraint is not permission to merge distinct events.

```sql
SELECT race_id, kind, count(*) FROM public.session
GROUP BY race_id, kind HAVING count(*) > 1;
```

Every duplicate group requires a reviewed choice. When rows are actual duplicate refreshes, preserve the selected stable ID, merge OpenF1 and actual timing metadata deliberately, and remap all video/other references before removing redundant rows in a separate reviewed transaction. Never DELETE the weekend's sessions and recreate them. The finalization script does not perform that reconciliation; it refuses duplicate groups.

### Predictions

Verify every existing prediction's season, round and canonical slug against `race`. Resolve invalid or renamed coordinates deliberately. The final FK uses season/round and restricts race deletion; slug consistency is checked during cutover and must remain enforced by canonical request/worker logic afterwards.

Regrade scored rows against complete, authoritative, versioned result/qualifying inputs, or review a deliberate return to the unscored state. Preserve the audit history of that decision. The final lifecycle allows either all-null score/timestamp/source-version, or a nonnegative score with timestamp and nonempty source version. Merely assigning a fake source version to an old potentially wrong score is not a regrade.

```sql
SELECT count(*) AS mismatched_races FROM public.prediction p
LEFT JOIN public.race r ON r.season_year = p.season AND r.round = p.round
WHERE r.id IS NULL OR p.race_slug IS DISTINCT FROM r.slug;
```

No existing prediction is automatically deleted or reset by these scripts.

## Stage 2 — gated finalization and coordinated code cutover

1. Complete the mapping/reconciliation/regrade evidence above. Validate reconstruction and both stages in an isolated database before scheduling the production cutover. Account for the write-lock duration; the SQL times out rather than silently blocking indefinitely.
2. Quiesce old result/session writers and scoring jobs. An old worker still using `(race_id, driver_id)` as a conflict target will fail after this key is removed. A new worker using the new source target cannot restore multiple entries while the legacy index is retained. Coordinate the worker switch with this boundary.
3. On the migration connection, explicitly select `apex.schema_hardening_release = '2026-09-30-finalize-reviewed-backfill'`, then execute the complete `manual/20260930_02_finalize.sql` transaction.
4. Verify source identity NOT NULL and unique pair; the exact old standalone index removed and replaced by a nonunique race-driver lookup index; stable session race-kind unique; canonical race FK and prediction lifecycle check. Compare the final catalog with source metadata and the documented service policy/grant matrix.
5. Deploy matched code, resume controlled ingestion, and test repeated/concurrent session updates preserve IDs/metadata/video links; historic multiple-result entries coexist; score writes are versioned and atomic; newsletter reservation/create/send ambiguity is handled without automatic retries from creating/sending/uncertain. Persist the lease-owned `creating` state before making the provider create request; an expired `reserved` lease may be reacquired only because no external create is allowed to have started from that state.

## Rollback and release limits

Before expansion commits, transaction rollback restores the starting state. After expansion, old code can continue only if it does not select the new final-state assumptions; leave added columns/index/empty ledger in place unless a separate removal plan proves they contain nothing needed. Do not drop a used newsletter ledger: that would erase duplicate-send protection.

Before finalization commits, its transaction is atomic. After historical multi-entry rows are restored, recreating the old race-driver unique key may be impossible without losing legitimate records. **Do not auto-delete records to roll back.** Use a reviewed code/database recovery plan and the retained mapping/backup. The scripts do not perform credential rotation, broad role changes, a full baseline migration, all-table CHECK hardening, or live deployment.
