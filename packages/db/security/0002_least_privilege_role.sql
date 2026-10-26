-- 0002_least_privilege_role.sql
--
-- Bound the blast radius of a leaked DATABASE_URL.
--
-- THIS ONE CHANGES HOW THE APP AUTHENTICATES. Read the whole file and follow
-- the cutover order in security/README.md. Applying it without updating
-- DATABASE_URL will take the site down.
--
-- THE PROBLEM IT SOLVES
--   DATABASE_URL today is the Supabase owner role. If it leaks -- via a log, a
--   misconfigured error page, a compromised Vercel account -- the holder can
--   read and write every table, DROP the schema, and reach anything else in the
--   database. Row level security does not help: owners bypass it by design.
--
--   0001 closes the anon/PostgREST surface. This closes the credential surface.
--
-- WHAT IT DOES
--   Creates apex_app: it can read and write rows in the application tables and
--   nothing else. No DDL, no DROP, no TRUNCATE, no access to other schemas, no
--   ability to create roles or read pg_authid. A leak becomes a data-integrity
--   incident instead of a total-loss incident.
--
-- STEP 1 -- generate a strong password (do not reuse anything):
--     openssl rand -base64 32
--
--   Then replace BOTH occurrences of REPLACE_WITH_GENERATED_PASSWORD below
--   with that value, keeping the surrounding single quotes.
--
--   Do NOT try to pass it as a psql variable. psql does not interpolate
--   :'name' inside dollar-quoted blocks, so :'app_password' would reach the
--   server uninterpolated and the statement would fail.

BEGIN;

-- Role: login only, no inherited superpowers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apex_app') THEN
    CREATE ROLE apex_app LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';
  ELSE
    ALTER ROLE apex_app LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD';
  END IF;
END
$$;

ALTER ROLE apex_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Schema visibility, but not the right to create objects in it.
GRANT USAGE ON SCHEMA public TO apex_app;
REVOKE CREATE ON SCHEMA public FROM apex_app;

-- Row-level CRUD on existing tables. Deliberately no TRUNCATE and no REFERENCES.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO apex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO apex_app;

-- Same treatment for tables added later, so a future migration cannot silently
-- leave the app without access (or hand it more than it needs).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO apex_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO apex_app;

-- apex_app is not an owner, so from here RLS applies to it for real. Give it an
-- explicit full-access policy on every table IN THE SAME TRANSACTION as the
-- grants, so there is never a window where the app is locked out.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS apex_app_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY apex_app_all ON public.%I FOR ALL TO apex_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

COMMIT;

-- VERIFY before cutting over -- this must return rows and not error:
--   SET ROLE apex_app;
--   SELECT count(*) FROM public.article;
--   RESET ROLE;
--
-- Then update DATABASE_URL in Vercel to authenticate as apex_app and redeploy.
-- Keep the owner URL somewhere safe: migrations and drizzle-kit still need it.
--
-- ROLLBACK (point DATABASE_URL back at the owner role first):
--   BEGIN;
--     DROP OWNED BY apex_app;
--     DROP ROLE apex_app;
--   COMMIT;
