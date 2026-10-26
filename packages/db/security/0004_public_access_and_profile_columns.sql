-- Operational security release, deliberately separate from schema upgrade DDL.
-- SOURCE ONLY until operator review + matched column projections/role cutover.
-- SET apex.public_access_release = '2026-09-30-reviewed';
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE t text;
BEGIN
  IF current_setting('apex.public_access_release', true) IS DISTINCT FROM '2026-09-30-reviewed' THEN
    RAISE EXCEPTION 'Review public access roles and deployment before selecting this release.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase API roles/auth.uid absent; do not infer another auth model.';
  END IF;
  FOR t IN SELECT unnest(ARRAY[
    'article', 'author', 'app_user', 'article_tag', 'article_driver', 'article_team', 'article_race',
    'circuit', 'driver', 'driver_team_history', 'image', 'lap', 'pit_stop', 'qualifying',
    'race', 'result', 'season', 'session', 'sprint_result', 'standing_driver', 'standing_team', 'tag', 'team', 'video'
  ]) LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'Expected application table % absent; reconcile the catalog first.', t;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN (
      'article', 'author', 'app_user', 'article_tag', 'article_driver', 'article_team', 'article_race'
    )
      AND roles && ARRAY['public','anon','authenticated','apex_public_reader']::name[]
      AND NOT (
        (tablename IN ('article','author','article_tag','article_driver','article_team','article_race')
          AND policyname = 'public_read' AND cmd = 'SELECT')
        OR (tablename = 'app_user' AND policyname = 'own_row_select' AND cmd = 'SELECT')
        OR (tablename = 'app_user' AND policyname = 'own_row_update' AND cmd = 'UPDATE')
        OR (tablename = 'app_user' AND policyname = 'own_row_upsert' AND cmd = 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'Unreviewed API policies exist; permissive policies can bypass the proposed restriction.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apex_public_reader') THEN
    CREATE ROLE apex_public_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'apex_public_reader'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit OR rolcanlogin)
  ) OR EXISTS (
    SELECT 1 FROM pg_auth_members WHERE member = 'apex_public_reader'::regrole
  ) THEN
    RAISE EXCEPTION 'Existing reader role has unreviewed attributes/memberships; create/reconcile a dedicated role.';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO apex_public_reader;
REVOKE CREATE ON SCHEMA public FROM apex_public_reader;
DO $$
BEGIN
  IF has_schema_privilege('apex_public_reader', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Reader inherits public-schema CREATE, possibly through PUBLIC; review its source explicitly.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relowner = 'apex_public_reader'::regrole
  ) THEN
    RAISE EXCEPTION 'Reader owns public objects and would bypass their RLS; reconcile ownership first.';
  END IF;
END
$$;

ALTER TABLE public.article ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.article, public.author, public.app_user FROM PUBLIC, anon, authenticated, apex_public_reader;
-- Table REVOKE is insufficient if an older release granted column privileges.
DO $$
DECLARE t text; cols text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['article','author','app_user']) LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
      FROM pg_attribute WHERE attrelid = format('public.%I', t)::regclass
        AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC, anon, authenticated, apex_public_reader', cols, t);
  END LOOP;
END
$$;
GRANT SELECT ON public.article TO anon, authenticated, apex_public_reader;
GRANT SELECT (id, slug, name, bio_md, avatar_url, twitter, instagram, created_at)
  ON public.author TO anon, authenticated, apex_public_reader;

ALTER POLICY public_read ON public.article TO anon, authenticated, apex_public_reader
  USING (published_at IS NOT NULL AND published_at <= now()
    AND (embargo_until IS NULL OR embargo_until <= now()) AND NOT is_premium);
ALTER POLICY public_read ON public.author TO anon, authenticated, apex_public_reader;

-- Never grant browser control of identity email/provider or premium entitlement.
-- Email remains NOT NULL, so identity provisioning is a trusted server task.
GRANT SELECT (id, display_name, locale, timezone, created_at, updated_at)
  ON public.app_user TO authenticated;
GRANT INSERT (id, display_name, locale, timezone) ON public.app_user TO authenticated;
GRANT UPDATE (display_name, locale, timezone) ON public.app_user TO authenticated;
ALTER POLICY own_row_select ON public.app_user TO authenticated USING (id = auth.uid());
ALTER POLICY own_row_update ON public.app_user TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
ALTER POLICY own_row_upsert ON public.app_user TO authenticated WITH CHECK (id = auth.uid());

-- The dedicated reader receives an explicit content allowlist, never future
-- default grants or private fan/operational tables. Preserve existing filters.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'article_tag', 'article_driver', 'article_team', 'article_race', 'circuit', 'driver',
    'driver_team_history', 'image', 'lap', 'pit_stop', 'qualifying', 'race', 'result',
    'season', 'session', 'sprint_result', 'standing_driver', 'standing_team', 'tag', 'team', 'video'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'public_read' AND cmd = 'SELECT'
    ) THEN
      RAISE EXCEPTION 'Expected reviewed public_read policy missing on %.', t;
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM apex_public_reader', t);
    EXECUTE format('GRANT SELECT ON public.%I TO apex_public_reader', t);
    EXECUTE format('ALTER POLICY public_read ON public.%I TO anon, authenticated, apex_public_reader', t);
  END LOOP;
  FOR t IN SELECT unnest(ARRAY['article_tag','article_driver','article_team','article_race']) LOOP
    EXECUTE format(
      'ALTER POLICY public_read ON public.%I USING (EXISTS (SELECT 1 FROM public.article a WHERE a.id = %I.article_id))', t, t);
  END LOOP;
  FOR t IN SELECT unnest(ARRAY['app_user','follow','saved','prediction','event_log','ingestion_run','newsletter_edition']) LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      IF has_any_column_privilege('apex_public_reader', format('public.%I', t), 'SELECT')
          OR has_any_column_privilege('apex_public_reader', format('public.%I', t), 'INSERT')
          OR has_any_column_privilege('apex_public_reader', format('public.%I', t), 'UPDATE')
          OR has_table_privilege('apex_public_reader', format('public.%I', t), 'DELETE') THEN
        RAISE EXCEPTION 'Reader has unexpected effective private-table access on %; audit its privilege source.', t;
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('apex_public_reader', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Reader can call an unreviewed public SECURITY DEFINER routine; review functions first.';
  END IF;
END
$$;

-- RLS does not constrain TRUNCATE/REFERENCES, and ordinary views use owner
-- privileges. Check the complete effective relation surface, including objects
-- absent from the historical table list and privileges inherited from PUBLIC.
DO $$
DECLARE rel record; write_privileges text := 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
  allowed text[] := ARRAY['article','author','article_tag','article_driver','article_team','article_race',
    'circuit','driver','driver_team_history','image','lap','pit_stop','qualifying','race','result','season',
    'session','sprint_result','standing_driver','standing_team','tag','team','video'];
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN write_privileges := write_privileges || ',MAINTAIN'; END IF;
  FOR rel IN SELECT c.oid, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
    IF rel.relkind = 'S' THEN
      IF has_sequence_privilege('apex_public_reader', rel.oid, 'SELECT,UPDATE,USAGE') THEN
        RAISE EXCEPTION 'Reader has unreviewed sequence privileges on %.', rel.relname;
      END IF;
    ELSIF has_table_privilege('apex_public_reader', rel.oid, write_privileges)
      OR has_any_column_privilege('apex_public_reader', rel.oid, 'INSERT,UPDATE,REFERENCES')
      OR (NOT rel.relname = ANY(allowed) AND has_any_column_privilege('apex_public_reader', rel.oid, 'SELECT')) THEN
      RAISE EXCEPTION 'Reader has unreviewed effective relation access on %.', rel.relname;
    END IF;
  END LOOP;
END
$$;

COMMIT;
