ALTER TABLE "prediction" DROP CONSTRAINT "prediction_score_lifecycle_check";--> statement-breakpoint
ALTER TABLE "race" ADD CONSTRAINT "race_status_check" CHECK ("race"."status" in ('completed','live','upcoming','testing','cancelled'));--> statement-breakpoint
ALTER TABLE "race" ADD CONSTRAINT "race_source_state_check" CHECK ("race"."schedule_source_state" in ('active','withdrawn','unreviewed'));--> statement-breakpoint
ALTER TABLE "race" ADD CONSTRAINT "race_coordinates_check" CHECK ("race"."season_year" between 1950 and 2200 and "race"."round" between 1 and 40);--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_kind_check" CHECK ("session"."kind" in ('FP1','FP2','FP3','SQ','S','Q','R'));--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_status_check" CHECK ("session"."status" in ('scheduled','live','completed','cancelled'));--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_source_state_check" CHECK ("session"."schedule_source_state" in ('active','unreported','unreviewed'));--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_identity_check" CHECK (length("prediction"."client_id") between 1 and 128 and "prediction"."season" between 1950 and 2200 and "prediction"."round" between 1 and 40 and length("prediction"."race_slug") between 1 and 160 and ("prediction"."handle" is null or length("prediction"."handle") <= 64));--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_picks_check" CHECK (jsonb_typeof("prediction"."picks") = 'object'
      and ("prediction"."picks" - array['pole','winner','podium','fastest_lap']) = '{}'::jsonb
      and (not ("prediction"."picks" ? 'pole') or (jsonb_typeof("prediction"."picks"->'pole')='string' and length("prediction"."picks"->>'pole') between 1 and 64))
      and (not ("prediction"."picks" ? 'winner') or (jsonb_typeof("prediction"."picks"->'winner')='string' and length("prediction"."picks"->>'winner') between 1 and 64))
      and (not ("prediction"."picks" ? 'podium') or (jsonb_typeof("prediction"."picks"->'podium')='string' and length("prediction"."picks"->>'podium') between 1 and 64))
      and (not ("prediction"."picks" ? 'fastest_lap') or (jsonb_typeof("prediction"."picks"->'fastest_lap')='string' and length("prediction"."picks"->>'fastest_lap') between 1 and 64)));--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_score_lifecycle_check" CHECK ((
        ("prediction"."score" IS NULL AND "prediction"."scored_at" IS NULL AND "prediction"."score_source_version" IS NULL)
        OR ("prediction"."score" IS NOT NULL AND "prediction"."score" >= 0 AND "prediction"."score" <= 13 AND "prediction"."scored_at" IS NOT NULL
          AND "prediction"."score_source_version" IS NOT NULL AND length(btrim("prediction"."score_source_version")) > 0)
      ));--> statement-breakpoint
ALTER TABLE "prediction_attempt" ADD CONSTRAINT "prediction_attempt_content_hash_check" CHECK ("prediction_attempt"."content_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint
ALTER TABLE "prediction_attempt" ADD CONSTRAINT "prediction_attempt_outcome_check" CHECK ("prediction_attempt"."outcome" in ('applied','conflict','locked'));