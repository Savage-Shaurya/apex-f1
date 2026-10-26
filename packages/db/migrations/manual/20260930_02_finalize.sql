-- MANUAL CUTOVER: do NOT run immediately after expansion without the reviewed
-- source-entry backfill, session occurrence reconciliation and prediction regrade.
-- This script never deletes/deduplicates/backfills application rows automatically.
-- It removes ONLY the inspected legacy result identity index after all guards pass.
--   SET apex.schema_hardening_release = '2026-09-30-finalize-reviewed-backfill';

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF current_setting('apex.schema_hardening_release', true)
      IS DISTINCT FROM '2026-09-30-finalize-reviewed-backfill' THEN
    RAISE EXCEPTION 'Manual finalized release not selected; review backfill and reconciliation first.';
  END IF;
  IF to_regclass('public.newsletter_edition') IS NULL
      OR to_regclass('public.result_source_entry_unique') IS NULL THEN
    RAISE EXCEPTION 'Expansion stage is not present; stop and verify the target.';
  END IF;
  IF to_regclass('public.result_race_driver_unique') IS NULL THEN
    RAISE EXCEPTION 'Legacy result key differs from expected cutover state.';
  END IF;
  IF pg_get_indexdef('public.result_race_driver_unique'::regclass)
      <> 'CREATE UNIQUE INDEX result_race_driver_unique ON public.result USING btree (race_id, driver_id)' THEN
    RAISE EXCEPTION 'Legacy result key definition differs; do not drop an unreviewed index.';
  END IF;
END
$$;

-- Keep row writers out between preflight and constraint/index installation.
-- A timeout aborts rather than waiting indefinitely behind production traffic.
LOCK TABLE public.result, public.session, public.prediction, public.race
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.result
    WHERE source IS NULL OR source_entry_id IS NULL
      OR length(btrim(source)) = 0 OR length(btrim(source_entry_id)) = 0
  ) THEN
    RAISE EXCEPTION 'Result source identities are incomplete; authoritative backfill required.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.result GROUP BY source, source_entry_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate result source identities; review entry mapping without deleting rows.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.session GROUP BY race_id, kind HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate session kinds need occurrence review and reference-preserving reconciliation.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prediction p
    LEFT JOIN public.race r ON r.season_year = p.season AND r.round = p.round
    WHERE r.id IS NULL OR p.race_slug IS DISTINCT FROM r.slug
  ) THEN
    RAISE EXCEPTION 'Prediction race coordinates/slug do not match canonical race; reconcile explicitly.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.prediction
    WHERE NOT (
      (score IS NULL AND scored_at IS NULL AND score_source_version IS NULL)
      OR (score IS NOT NULL AND score >= 0 AND scored_at IS NOT NULL
          AND score_source_version IS NOT NULL AND length(btrim(score_source_version)) > 0)
    )
  ) THEN
    RAISE EXCEPTION 'Prediction score lifecycle inconsistent; regrade against versioned complete inputs first.';
  END IF;
END
$$;

ALTER TABLE public.result ALTER COLUMN source SET NOT NULL;
ALTER TABLE public.result ALTER COLUMN source_entry_id SET NOT NULL;
ALTER TABLE public.result DROP CONSTRAINT result_source_identity_check;
ALTER TABLE public.result ADD CONSTRAINT result_source_identity_check CHECK (
  length(btrim(source)) > 0 AND length(btrim(source_entry_id)) > 0
);
CREATE INDEX result_race_driver_idx ON public.result (race_id, driver_id);
DROP INDEX public.result_race_driver_unique;

CREATE UNIQUE INDEX session_race_kind_unique ON public.session (race_id, kind);

ALTER TABLE public.prediction ADD CONSTRAINT prediction_season_round_race_fk
  FOREIGN KEY (season, round) REFERENCES public.race (season_year, round) ON DELETE RESTRICT;
ALTER TABLE public.prediction ADD CONSTRAINT prediction_score_lifecycle_check CHECK (
  (score IS NULL AND scored_at IS NULL AND score_source_version IS NULL)
  OR (score IS NOT NULL AND score >= 0 AND scored_at IS NOT NULL
      AND score_source_version IS NOT NULL AND length(btrim(score_source_version)) > 0)
);

COMMIT;
