-- ROLE SESSION TIMEOUTS (BE-10). Run as the role administrator (Supabase: postgres
-- through the dashboard SQL editor or the session pooler on port 5432), after 0005.
-- Select apex.role_timeouts_release='2026-10-26-role-timeouts' on this connection.
--
-- Why: the application sends statement_timeout, lock_timeout and
-- idle_in_transaction_session_timeout as connection startup parameters
-- (packages/db/src/client.ts). Supabase's transaction pooler (port 6543), which
-- the app uses, does not apply them. Measured read-only on apex-staging
-- 2026-10-26: a pooled apex_runtime/apex_worker session ran with
-- statement_timeout=2min, lock_timeout=0, idle_in_transaction_session_timeout=0,
-- and a 16 s pg_sleep completed. Role defaults are applied by PostgreSQL itself
-- when the pooler opens its server connection, so they bound every statement,
-- including single-statement page reads that run outside a transaction.
-- Application transactions additionally set the same limits transaction-locally
-- (packages/db/src/bounded-transaction.ts).
--
-- Changes only these three settings on the three application roles. No grants,
-- no policies, no passwords. Idempotent: rerunning sets the same values.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE role_name text;
BEGIN
  IF current_setting('apex.role_timeouts_release', true) IS DISTINCT FROM '2026-10-26-role-timeouts' THEN
    RAISE EXCEPTION 'Select the explicitly reviewed role timeout release.';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['apex_runtime','apex_worker','apex_public'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      RAISE EXCEPTION 'Application role % is missing; provision roles and apply 0005 first.', role_name;
    END IF;
  END LOOP;
END $$;
ALTER ROLE apex_runtime SET statement_timeout = '15s';
ALTER ROLE apex_runtime SET lock_timeout = '5s';
ALTER ROLE apex_runtime SET idle_in_transaction_session_timeout = '15s';
-- Ingestion statements (a season calendar, a 500-row grading page) get more room.
ALTER ROLE apex_worker SET statement_timeout = '30s';
ALTER ROLE apex_worker SET lock_timeout = '5s';
ALTER ROLE apex_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE apex_public SET statement_timeout = '15s';
ALTER ROLE apex_public SET lock_timeout = '5s';
ALTER ROLE apex_public SET idle_in_transaction_session_timeout = '15s';
COMMIT;
