-- MANUAL STAGED UPGRADE, NOT A FRESH-DATABASE BASELINE OR DRIZZLE JOURNAL ENTRY.
-- Read ../README.md. No application rows are rewritten or deleted here.
-- Run only after review, backup and verification of the target catalog.
-- Explicitly set this session's opt-in before running the entire transaction:
--   SET apex.schema_hardening_release = '2026-09-30-expand';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_setting('apex.schema_hardening_release', true)
      IS DISTINCT FROM '2026-09-30-expand' THEN
    RAISE EXCEPTION 'Manual expand release not selected. Read migrations/README.md.';
  END IF;
  IF to_regclass('public.result') IS NULL OR to_regclass('public.race') IS NULL
      OR to_regclass('public.session') IS NULL OR to_regclass('public.prediction') IS NULL THEN
    RAISE EXCEPTION 'Existing Apex baseline required; this script does not provision it.';
  END IF;
  IF to_regclass('public.result_race_driver_unique') IS NULL THEN
    RAISE EXCEPTION 'Expected existing result_race_driver_unique index missing; compare catalog first.';
  END IF;
  IF pg_get_indexdef('public.result_race_driver_unique'::regclass)
      <> 'CREATE UNIQUE INDEX result_race_driver_unique ON public.result USING btree (race_id, driver_id)' THEN
    RAISE EXCEPTION 'Result identity index differs from inspected catalog; stop and reconcile.';
  END IF;
  IF to_regclass('public.newsletter_edition') IS NOT NULL THEN
    RAISE EXCEPTION 'newsletter_edition already exists; this one-time stage must not overwrite it.';
  END IF;
END
$$;

-- Nullable expansion lets existing rows retain their IDs and values until a
-- reviewed authoritative source-entry backfill. The old uniqueness remains.
ALTER TABLE public.result ADD COLUMN source text;
ALTER TABLE public.result ADD COLUMN source_entry_id text;
ALTER TABLE public.result ADD CONSTRAINT result_source_identity_check CHECK (
  (source IS NULL AND source_entry_id IS NULL)
  OR (source IS NOT NULL AND source_entry_id IS NOT NULL
      AND length(btrim(source)) > 0 AND length(btrim(source_entry_id)) > 0)
);
CREATE UNIQUE INDEX result_source_entry_unique ON public.result (source, source_entry_id);

ALTER TABLE public.prediction ADD COLUMN score_source_version text;

CREATE TABLE public.newsletter_edition (
  edition_key text PRIMARY KEY,
  state text NOT NULL DEFAULT 'reserved',
  broadcast_id text,
  attempt_id uuid NOT NULL,
  lease_expires_at timestamptz,
  error text,
  error_at timestamptz,
  broadcast_created_at timestamptz,
  sending_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_edition_key_check CHECK (length(btrim(edition_key)) > 0),
  CONSTRAINT newsletter_edition_state_check CHECK (
    state IN ('reserved', 'creating', 'broadcast_created', 'sending', 'sent', 'failed', 'uncertain')
  ),
  CONSTRAINT newsletter_edition_broadcast_check CHECK (
    state NOT IN ('broadcast_created', 'sending', 'sent')
    OR (broadcast_id IS NOT NULL AND length(btrim(broadcast_id)) > 0)
  ),
  CONSTRAINT newsletter_edition_active_lease_check CHECK (
    state NOT IN ('reserved', 'creating', 'broadcast_created', 'sending') OR lease_expires_at IS NOT NULL
  ),
  CONSTRAINT newsletter_edition_sent_check CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX newsletter_edition_state_lease_idx ON public.newsletter_edition (state, lease_expires_at);

-- This ledger is private. A newly created Supabase public table can inherit
-- default API grants; remove them in the same transaction as its creation.
ALTER TABLE public.newsletter_edition ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.newsletter_edition FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.newsletter_edition FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.newsletter_edition FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apex_app') THEN
    REVOKE ALL ON public.newsletter_edition FROM apex_app;
    GRANT SELECT, INSERT, UPDATE ON public.newsletter_edition TO apex_app;
    CREATE POLICY newsletter_edition_app ON public.newsletter_edition
      FOR ALL TO apex_app USING (true) WITH CHECK (true);
  END IF;
END
$$;

COMMIT;
