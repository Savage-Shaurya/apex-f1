-- 0003_revoke_postgrest_grants.sql
--
-- APPLIED to the live database on 2026-08-12 via the Supabase Management API.
-- Recorded here so the change is reviewable and reproducible.
--
-- WHAT WAS FOUND
--   RLS was already enabled on all 29 public tables, and the policies were
--   sound: 23 public-content tables readable by anon (qual = true), saved and
--   follow scoped to user_id = auth.uid(), app_user scoped to id = auth.uid(),
--   and prediction / event_log / ingestion_run carrying RLS with no policy at
--   all, i.e. deny by default. No PII sits in the publicly readable set, and
--   there are no SECURITY DEFINER functions to escalate through.
--
--   The grants told a different story. Both anon and authenticated held
--   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER and REFERENCES on all 29
--   tables -- Supabase's default grant, never narrowed.
--
-- WHY THAT MATTERED
--   RLS filters rows for SELECT / INSERT / UPDATE / DELETE, so the write grants
--   were mostly inert: no policy permits an anon write, so PostgREST would have
--   rejected one.
--
--   TRUNCATE is the exception. It is a table-level privilege and is NOT subject
--   to row level security -- no policy can stop it. Holding TRUNCATE on every
--   table is a table-emptying primitive sitting one exposure away from the
--   public anon role, and RLS provides no defence against it.
--
--   TRIGGER and REFERENCES are likewise schema-shaping privileges that no
--   PostgREST client has any business holding.
--
-- WHY IT WAS SAFE TO APPLY
--   Apex does not use @supabase/supabase-js anywhere. The application connects
--   as postgres via DATABASE_URL, which owns these tables and carries
--   rolbypassrls, so none of these grants were on any application code path.
--   Verified after applying: /latest, /predict, /results/2026/drivers,
--   /results/2026/teams, /video and /search all returned 200 with content.

BEGIN;

-- Neither role should ever hold table-shaping or table-emptying rights.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- anon is a read-only audience. No policy grants it a write, so this removes a
-- privilege that was already unusable rather than changing behaviour.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- Without this, the next table created re-grants the full default set and
-- silently undoes the above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

COMMIT;

-- RESULTING STATE (verified):
--   anon          -> SELECT
--   authenticated -> SELECT, INSERT, UPDATE, DELETE
--
-- VERIFY:
--   SELECT grantee, string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
--   GROUP BY grantee;
--
-- ROLLBACK (restores the permissive Supabase default -- not recommended):
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
