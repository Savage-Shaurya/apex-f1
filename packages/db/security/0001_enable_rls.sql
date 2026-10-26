-- 0001_enable_rls.sql
--
-- Enable Row Level Security on every application table and revoke the
-- Supabase PostgREST roles from them.
--
-- WHY THIS IS SAFE FOR THE RUNNING APP
--   Apex does not use @supabase/supabase-js. It connects via postgres-js
--   with DATABASE_URL, which on Supabase is the table-owning role. A table
--   owner BYPASSES row level security unless FORCE ROW LEVEL SECURITY is
--   also set, and this migration deliberately does NOT set FORCE. Every
--   query the application makes today behaves exactly as it does now.
--
-- WHAT IT ACTUALLY BUYS
--   Every Supabase project publishes PostgREST at
--   https://<ref>.supabase.co/rest/v1/ backed by the anon and authenticated
--   roles. With RLS off, any table those roles hold a grant on is readable
--   by anyone holding the anon key -- which ships to browsers by design.
--   Enabling RLS denies them by default (no policy means no rows), and the
--   REVOKE below drops the grant too. Belt and braces.
--
-- WHAT IT DOES NOT BUY
--   This is not protection against a leaked DATABASE_URL. That credential is
--   the owner role and bypasses RLS by design. Bounding that blast radius
--   needs the least-privilege role in 0002, which changes how the app
--   authenticates and must be rolled out deliberately.
--
-- Idempotent. Safe to re-run. Rollback at the bottom of this file.

BEGIN;

ALTER TABLE public.app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_driver ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_race ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.author ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circuit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_team_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pit_stop ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualifying ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprint_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standing_driver ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standing_team ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video ENABLE ROW LEVEL SECURITY;

-- Drop PostgREST role grants where those roles exist. Guarded so this file
-- also runs on a plain Postgres instance with no anon/authenticated roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.app_user FROM anon;
    REVOKE ALL ON public.article FROM anon;
    REVOKE ALL ON public.article_driver FROM anon;
    REVOKE ALL ON public.article_race FROM anon;
    REVOKE ALL ON public.article_tag FROM anon;
    REVOKE ALL ON public.article_team FROM anon;
    REVOKE ALL ON public.author FROM anon;
    REVOKE ALL ON public.circuit FROM anon;
    REVOKE ALL ON public.driver FROM anon;
    REVOKE ALL ON public.driver_team_history FROM anon;
    REVOKE ALL ON public.event_log FROM anon;
    REVOKE ALL ON public.follow FROM anon;
    REVOKE ALL ON public.image FROM anon;
    REVOKE ALL ON public.ingestion_run FROM anon;
    REVOKE ALL ON public.lap FROM anon;
    REVOKE ALL ON public.pit_stop FROM anon;
    REVOKE ALL ON public.prediction FROM anon;
    REVOKE ALL ON public.qualifying FROM anon;
    REVOKE ALL ON public.race FROM anon;
    REVOKE ALL ON public.result FROM anon;
    REVOKE ALL ON public.saved FROM anon;
    REVOKE ALL ON public.season FROM anon;
    REVOKE ALL ON public.session FROM anon;
    REVOKE ALL ON public.sprint_result FROM anon;
    REVOKE ALL ON public.standing_driver FROM anon;
    REVOKE ALL ON public.standing_team FROM anon;
    REVOKE ALL ON public.tag FROM anon;
    REVOKE ALL ON public.team FROM anon;
    REVOKE ALL ON public.video FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.app_user FROM authenticated;
    REVOKE ALL ON public.article FROM authenticated;
    REVOKE ALL ON public.article_driver FROM authenticated;
    REVOKE ALL ON public.article_race FROM authenticated;
    REVOKE ALL ON public.article_tag FROM authenticated;
    REVOKE ALL ON public.article_team FROM authenticated;
    REVOKE ALL ON public.author FROM authenticated;
    REVOKE ALL ON public.circuit FROM authenticated;
    REVOKE ALL ON public.driver FROM authenticated;
    REVOKE ALL ON public.driver_team_history FROM authenticated;
    REVOKE ALL ON public.event_log FROM authenticated;
    REVOKE ALL ON public.follow FROM authenticated;
    REVOKE ALL ON public.image FROM authenticated;
    REVOKE ALL ON public.ingestion_run FROM authenticated;
    REVOKE ALL ON public.lap FROM authenticated;
    REVOKE ALL ON public.pit_stop FROM authenticated;
    REVOKE ALL ON public.prediction FROM authenticated;
    REVOKE ALL ON public.qualifying FROM authenticated;
    REVOKE ALL ON public.race FROM authenticated;
    REVOKE ALL ON public.result FROM authenticated;
    REVOKE ALL ON public.saved FROM authenticated;
    REVOKE ALL ON public.season FROM authenticated;
    REVOKE ALL ON public.session FROM authenticated;
    REVOKE ALL ON public.sprint_result FROM authenticated;
    REVOKE ALL ON public.standing_driver FROM authenticated;
    REVOKE ALL ON public.standing_team FROM authenticated;
    REVOKE ALL ON public.tag FROM authenticated;
    REVOKE ALL ON public.team FROM authenticated;
    REVOKE ALL ON public.video FROM authenticated;
  END IF;
END
$$;

COMMIT;

-- VERIFY (every row should show rowsecurity = true):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- ROLLBACK -- run only if the app starts returning empty result sets, which
-- would mean DATABASE_URL is NOT the owner role after all:
--
-- BEGIN;
--   ALTER TABLE public.app_user DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.article DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.article_driver DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.article_race DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.article_tag DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.article_team DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.author DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.circuit DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.driver DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.driver_team_history DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.event_log DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.follow DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.image DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.ingestion_run DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.lap DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.pit_stop DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.prediction DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.qualifying DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.race DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.result DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.saved DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.season DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.session DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.sprint_result DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.standing_driver DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.standing_team DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.tag DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.team DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.video DISABLE ROW LEVEL SECURITY;
-- COMMIT;
