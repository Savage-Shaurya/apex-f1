-- NEW SUPABASE PROJECT ONLY, BEFORE ANY MIGRATION (BE-3).
-- Run as `postgres` (dashboard SQL editor or session pooler, port 5432) after the
-- roles apex_owner, apex_runtime, apex_worker and apex_public were provisioned
-- privately (see ../../migrations/README.md). Then apply the Drizzle journal as
-- apex_owner and ../0005_fresh_runtime_roles.sql, then ../0006_role_session_timeouts.sql.
-- Select apex.supabase_template_release='2026-10-26-supabase-template' on this connection.
--
-- Why: a new Supabase project's template makes 0005 refuse, correctly. Its
-- `public` schema carries default ACLs (owners postgres and supabase_admin)
-- that grant every future table to anon, authenticated and service_role, plus
-- a SECURITY DEFINER rls_auto_enable() event-trigger function. `postgres` is not
-- a superuser there and cannot ALTER DEFAULT PRIVILEGES for supabase_admin
-- (42501), so revoking is impossible. Default ACLs belong to their schema, so
-- dropping the EMPTY template schema and recreating it owned by apex_owner
-- removes them for real. This is exactly what provisioned apex-staging on
-- 2026-10-25 (docs/DATABASE-SETUP.md section 3); this script makes it repeatable
-- and refuses to touch a schema that holds anything.
--
-- Not done here: role/password creation (private), turning off Data API
-- exposure (Management API: db_schema = '', db_extra_search_path = ''; the app
-- does not use PostgREST).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE item record;
BEGIN
  IF current_setting('apex.supabase_template_release', true) IS DISTINCT FROM '2026-10-26-supabase-template' THEN
    RAISE EXCEPTION 'Select the explicitly reviewed Supabase template release.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    RAISE EXCEPTION 'Not a Supabase template database; plain PostgreSQL needs no reconcile step.';
  END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Run as postgres.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apex_owner' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole) THEN
    RAISE EXCEPTION 'Provision apex_owner (LOGIN, NOSUPERUSER, NOCREATEROLE, NOBYPASSRLS) first.';
  END IF;
  -- The schema must be the untouched template: no relations, no types, no
  -- routines except the template's rls_auto_enable(). Anything else stops here.
  FOR item IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace LOOP
    RAISE EXCEPTION 'public is not empty (relation %); this script only reconciles a new project.', item.relname;
  END LOOP;
  FOR item IN SELECT t.typname FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace LOOP
    RAISE EXCEPTION 'public is not empty (type %).', item.typname;
  END LOOP;
  FOR item IN SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'rls_auto_enable' LOOP
    RAISE EXCEPTION 'public is not empty (routine %).', item.proname;
  END LOOP;
  IF to_regnamespace('drizzle') IS NOT NULL THEN
    RAISE EXCEPTION 'A drizzle migration schema already exists; this is not a new project.';
  END IF;
END $$;

-- Drizzle's migrator creates schema `drizzle`; postgres must be able to act as
-- apex_owner to create the replacement schema with that owner.
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO apex_owner', current_database()); END $$;
GRANT apex_owner TO postgres WITH INHERIT TRUE, SET TRUE;

-- Removes the template's default ACLs (they live on the schema), the SECURITY
-- DEFINER rls_auto_enable() and its event trigger ensure_rls (CASCADE).
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION apex_owner;
COMMENT ON SCHEMA public IS 'Apex application schema (owner apex_owner); reconciled from the Supabase template, no default ACLs.';
REVOKE ALL ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclobjtype IN ('r','S') AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace) AND a.grantee <> d.defaclrole) THEN
    RAISE EXCEPTION 'Global default ACLs still grant future tables; 0005 would refuse. Review pg_default_acl before continuing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(oid, 'public', 'USAGE')) THEN
    RAISE EXCEPTION 'Browser API roles still have USAGE on public.';
  END IF;
END $$;
COMMIT;
