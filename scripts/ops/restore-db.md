# Restoring an Apex database backup

Backups are made by `scripts/ops/backup-db.mjs` (nightly GitHub Action `db-backup.yml`) and stored in the
**private** Supabase Storage bucket `apex-backups` of project `fikqugdusgwzfxviquby`:

| Object | What it is |
|---|---|
| `daily/YYYY-MM-DD.dump` | `pg_dump --format=custom --compress=9 --schema=public --schema=drizzle` (UTC date). Newest 14 kept. |
| `daily/YYYY-MM-DD.dump.sha256` | `sha256sum` line for the dump next to it. |
| `weekly/YYYY-Www.dump` (+ `.sha256`) | Newest backup of each ISO week. Newest 8 kept. |
| `latest.json` | Manifest of the newest backup: object name, bytes, sha256, server and pg_dump versions, table count. |

You need a PostgreSQL **17** client (`pg_restore`, `psql`; same major as the server, 17.x). Nothing below
writes to production until step 4, and step 4 is only for a real disaster.

## 1. Download a backup (Supabase dashboard or API)

Dashboard: Storage > `apex-backups` > `daily` > pick the file > Download. Also download its `.sha256` file.

API (service key from Supabase > Project Settings > API keys; keep it out of shell history and logs):

```bash
read -rs SUPABASE_SERVICE_ROLE_KEY   # paste, press Enter (not echoed)
BASE=https://fikqugdusgwzfxviquby.supabase.co/storage/v1/object/authenticated/apex-backups
curl -fsS -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "$BASE/latest.json"
D=2026-10-26
for f in daily/$D.dump daily/$D.dump.sha256; do
  curl -fsS -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -o "$(basename $f)" "$BASE/$f"
done
unset SUPABASE_SERVICE_ROLE_KEY
```

## 2. Verify the backup without touching production

```bash
shasum -a 256 -c $D.dump.sha256          # Linux: sha256sum -c   -> "<file>: OK"
pg_restore --list $D.dump | head -15     # header: "Format: CUSTOM", "Dumped from database version: 17.x"
pg_restore --list $D.dump | grep -c ' TABLE public '   # must print 35
```

Also compare `bytes` and `sha256` with `latest.json` (or with the size in the Storage dashboard).

## 3. Full restore drill into a local, isolated Postgres (recommended monthly)

Any empty local PostgreSQL 17 works (Postgres.app, Docker `postgres:17`, or a portable build). Never point
this at the production database.

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
for r in apex_owner apex_runtime apex_worker apex_public; do psql -qc "CREATE ROLE $r NOLOGIN"; done
psql -qc "CREATE DATABASE apex_restore_check OWNER apex_owner TEMPLATE template0"
psql -d apex_restore_check -qc "DROP SCHEMA public"     # the dump recreates it with its owner and ACLs
pg_restore -d apex_restore_check --exit-on-error --single-transaction $D.dump && echo RESTORE_OK
psql -d apex_restore_check -Atc "select count(*) from pg_tables where schemaname='public'"   # 35
psql -d apex_restore_check -Atc "select count(*) from pg_policies where schemaname='public'" # 90
psql -d apex_restore_check -Atc "select count(*) from drizzle.__drizzle_migrations"          # 4 (grows with migrations)
psql -d apex_restore_check -Atc "select count(*) from race"                                 # 23 for the 2026 season
```

If you do not want to create the roles, add `--no-owner --no-acl` to `pg_restore` (then grants and owners are
not restored; fine for checking data only).

## 4. Real disaster restore into Supabase (production)

Only when production data is lost or corrupted. Take a fresh backup first (run the workflow) so the current
state is also kept.

1. Pause writers: in Vercel, set the cron routes aside (or temporarily remove `CRON_SECRET` so cron calls fail)
   and disable the GitHub refresh workflows (Actions > each workflow > Disable).
2. Use the **owner** session URL (`apex_owner`, port **5432**, `sslmode=verify-full`, CA
   `prod-ca-2021.crt`). Put the parts in `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` (`read -rs PGPASSWORD`), not
   on the command line.
3. Restore over the existing objects in one transaction:

   ```bash
   export PGSSLMODE=verify-full PGSSLROOTCERT=/path/to/prod-ca-2021.crt
   pg_restore --clean --if-exists --exit-on-error --single-transaction -d postgres $D.dump
   ```

   `--clean --if-exists` drops and recreates only the objects in the dump (schemas `public` and `drizzle`).
   Supabase's own schemas (`auth`, `storage`, ...) are not in the dump and are not touched. The four roles
   must already exist (they do on the live project; on a brand-new project create them first, see
   `docs/DATABASE-SETUP.md` section 2). If dropping schema `public` itself fails because of ownership, restore
   into a new Supabase project instead and point Vercel at it.
4. Check: 35 tables, 90 policies, row counts look right, `/api/health` is `ok`, `/predict` loads.
5. Re-enable the workflows and crons. Note the restored backup date in `docs/HANDOFF.md`.

## 5. Manual backup now

GitHub > Actions > **Database backup** > Run workflow. Or locally (PostgreSQL 17 client on PATH or `PG_BIN_DIR`):

```bash
read -rs SUPABASE_BACKUP_DB_URL; read -rs SUPABASE_SERVICE_ROLE_KEY
export SUPABASE_BACKUP_DB_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL=https://fikqugdusgwzfxviquby.supabase.co
node scripts/ops/backup-db.mjs
```

The script prints 7 numbered steps and a one-line JSON result (object, bytes, sha256). It never prints secrets.
