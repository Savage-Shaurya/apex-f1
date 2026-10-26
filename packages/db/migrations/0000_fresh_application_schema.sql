CREATE TABLE "season" (
	"year" integer PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "circuit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"lat" real,
	"lon" real,
	"length_km" real,
	"corners" integer,
	"lap_record_ms" integer,
	"lap_record_holder" text,
	"lap_record_year" integer,
	"svg_path" text,
	"image_url" text,
	"wiki_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "circuit_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "race" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_year" integer NOT NULL,
	"round" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"circuit_id" uuid,
	"date_start" timestamp with time zone NOT NULL,
	"date_end" timestamp with time zone,
	"timezone" text,
	"is_sprint" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"hero_image_url" text,
	"wiki_url" text,
	"schedule_source" text,
	"schedule_source_state" text DEFAULT 'unreviewed' NOT NULL,
	"schedule_observation_id" uuid,
	"status_source_url" text,
	"status_source_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone,
	"actual_start" timestamp with time zone,
	"actual_end" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"openf1_session_key" text,
	"schedule_source" text,
	"schedule_source_state" text DEFAULT 'unreviewed' NOT NULL,
	"schedule_observation_id" uuid,
	"status_source_url" text,
	"status_source_observed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"code" text,
	"permanent_number" integer,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name" text NOT NULL,
	"nationality" text NOT NULL,
	"country_code" text,
	"dob" date,
	"debut_year" integer,
	"retired_year" integer,
	"bio_md" text,
	"headshot_url" text,
	"helmet_url" text,
	"profile_image_url" text,
	"wiki_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "driver_team_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"season_year" integer NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text,
	"base" text,
	"principal" text,
	"technical_chief" text,
	"power_unit" text,
	"founded_year" integer,
	"color_hex" text DEFAULT '#262626' NOT NULL,
	"logo_url" text,
	"car_image_url" text,
	"livery_image_url" text,
	"championships_count" integer DEFAULT 0,
	"wiki_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"lap_number" integer NOT NULL,
	"position" integer,
	"time_ms" bigint
);
--> statement-breakpoint
CREATE TABLE "pit_stop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"lap" integer NOT NULL,
	"time_of_day" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "qualifying" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"q1_ms" bigint,
	"q2_ms" bigint,
	"q3_ms" bigint,
	"position" integer
);
--> statement-breakpoint
CREATE TABLE "result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_entry_id" text NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"position" integer,
	"position_text" text NOT NULL,
	"points" real NOT NULL,
	"laps" integer,
	"time_ms" bigint,
	"gap_to_leader" text,
	"status" text NOT NULL,
	"grid" integer,
	"fastest_lap_rank" integer,
	"fastest_lap_time_ms" bigint,
	"fastest_lap_lap" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "result_source_identity_check" CHECK (length(btrim("result"."source")) > 0 AND length(btrim("result"."source_entry_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sprint_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"race_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"position" integer,
	"points" real NOT NULL,
	"time_ms" bigint,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_driver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"season_year" integer NOT NULL,
	"driver_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"position" integer NOT NULL,
	"points" real NOT NULL,
	"wins" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_team" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'legacy-unreviewed' NOT NULL,
	"season_year" integer NOT NULL,
	"team_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"position" integer NOT NULL,
	"points" real NOT NULL,
	"wins" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"dek" text,
	"body_md" text,
	"excerpt" text,
	"type" text DEFAULT 'news' NOT NULL,
	"section" text,
	"author_id" uuid,
	"hero_image_url" text,
	"thumbnail_url" text,
	"og_image_url" text,
	"read_time_minutes" integer,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embargo_until" timestamp with time zone,
	"is_breaking" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_premium" boolean DEFAULT false NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "article_driver" (
	"article_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	CONSTRAINT "article_driver_article_id_driver_id_pk" PRIMARY KEY("article_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "article_race" (
	"article_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	CONSTRAINT "article_race_article_id_race_id_pk" PRIMARY KEY("article_id","race_id")
);
--> statement-breakpoint
CREATE TABLE "article_tag" (
	"article_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "article_tag_article_id_tag_id_pk" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "article_team" (
	"article_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "article_team_article_id_team_id_pk" PRIMARY KEY("article_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"provider" text NOT NULL,
	"provider_asset_id" text NOT NULL,
	"title" text NOT NULL,
	"description_md" text,
	"duration_seconds" integer,
	"thumbnail_url" text,
	"embed_url" text,
	"hls_url" text,
	"availability" text DEFAULT 'public',
	"race_id" uuid,
	"session_id" uuid,
	"channel_name" text,
	"channel_handle" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"original_url" text NOT NULL,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"focal_x" real,
	"focal_y" real,
	"license" text,
	"attribution" text,
	"blurhash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'topic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "author" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"bio_md" text,
	"avatar_url" text,
	"twitter" text,
	"instagram" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "follow" (
	"user_id" uuid NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_user_id_entity_kind_entity_id_pk" PRIMARY KEY("user_id","entity_kind","entity_id")
);
--> statement-breakpoint
CREATE TABLE "saved" (
	"user_id" uuid NOT NULL,
	"content_kind" text NOT NULL,
	"content_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_user_id_content_kind_content_id_pk" PRIMARY KEY("user_id","content_kind","content_id")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"oauth_provider" text,
	"locale" text DEFAULT 'en',
	"timezone" text,
	"apex_plus_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"anonymous_id" text,
	"name" text NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"items_in" integer DEFAULT 0,
	"items_out" integer DEFAULT 0,
	"error" text,
	"details" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "prediction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"handle" text,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"race_slug" text NOT NULL,
	"picks" jsonb NOT NULL,
	"score" integer,
	"scored_at" timestamp with time zone,
	"score_source_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_score_lifecycle_check" CHECK ((
        ("prediction"."score" IS NULL AND "prediction"."scored_at" IS NULL AND "prediction"."score_source_version" IS NULL)
        OR ("prediction"."score" IS NOT NULL AND "prediction"."score" >= 0 AND "prediction"."scored_at" IS NOT NULL
          AND "prediction"."score_source_version" IS NOT NULL AND length(btrim("prediction"."score_source_version")) > 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "newsletter_edition" (
	"edition_key" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"broadcast_id" text,
	"attempt_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"error_at" timestamp with time zone,
	"broadcast_created_at" timestamp with time zone,
	"sending_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_edition_key_check" CHECK (length(btrim("newsletter_edition"."edition_key")) > 0),
	CONSTRAINT "newsletter_edition_state_check" CHECK ("newsletter_edition"."state" IN ('reserved', 'creating', 'broadcast_created', 'sending', 'sent', 'failed', 'uncertain')),
	CONSTRAINT "newsletter_edition_broadcast_check" CHECK ("newsletter_edition"."state" NOT IN ('broadcast_created', 'sending', 'sent')
        OR ("newsletter_edition"."broadcast_id" IS NOT NULL AND length(btrim("newsletter_edition"."broadcast_id")) > 0)),
	CONSTRAINT "newsletter_edition_active_lease_check" CHECK ("newsletter_edition"."state" NOT IN ('reserved', 'creating', 'broadcast_created', 'sending') OR "newsletter_edition"."lease_expires_at" IS NOT NULL),
	CONSTRAINT "newsletter_edition_sent_check" CHECK ("newsletter_edition"."state" <> 'sent' OR "newsletter_edition"."sent_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "newsletter_edition" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "source_snapshot" (
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"observation_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_observation_id" uuid,
	"content_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "source_snapshot_source_scope_pk" PRIMARY KEY("source","scope"),
	CONSTRAINT "source_snapshot_generation_check" CHECK ("source_snapshot"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "source_snapshot_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"generation" bigint NOT NULL,
	"observation_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lease" (
	"key" text PRIMARY KEY NOT NULL,
	"token" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_attempt" (
	"client_id" text NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"attempt_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"content_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"prediction_revision" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_attempt_client_id_season_round_attempt_id_pk" PRIMARY KEY("client_id","season","round","attempt_id"),
	CONSTRAINT "prediction_attempt_hash_check" CHECK ("prediction_attempt"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "editorial_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"actor" text NOT NULL,
	"operation" text NOT NULL,
	"previous_revision" timestamp with time zone,
	"revision" timestamp with time zone NOT NULL,
	"publication" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorial_audit_actor_check" CHECK (length(btrim("editorial_audit"."actor")) between 1 and 64),
	CONSTRAINT "editorial_audit_operation_check" CHECK ("editorial_audit"."operation" in ('create', 'update', 'publication'))
);
--> statement-breakpoint
-- PostgreSQL must see the composite unique key BEFORE referencing foreign keys.
-- drizzle-kit 0.31.10 emitted this index after all FK statements; reordered
-- without changing the declared final schema after native fresh-install failure.
CREATE UNIQUE INDEX "race_season_round_unique" ON "race" USING btree ("season_year","round");--> statement-breakpoint
ALTER TABLE "race" ADD CONSTRAINT "race_season_year_season_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."season"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race" ADD CONSTRAINT "race_circuit_id_circuit_id_fk" FOREIGN KEY ("circuit_id") REFERENCES "public"."circuit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_team_history" ADD CONSTRAINT "driver_team_history_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_team_history" ADD CONSTRAINT "driver_team_history_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_team_history" ADD CONSTRAINT "driver_team_history_season_year_season_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."season"("year") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lap" ADD CONSTRAINT "lap_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lap" ADD CONSTRAINT "lap_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pit_stop" ADD CONSTRAINT "pit_stop_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pit_stop" ADD CONSTRAINT "pit_stop_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying" ADD CONSTRAINT "qualifying_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifying" ADD CONSTRAINT "qualifying_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result" ADD CONSTRAINT "result_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_result" ADD CONSTRAINT "sprint_result_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_result" ADD CONSTRAINT "sprint_result_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_driver" ADD CONSTRAINT "standing_driver_season_year_season_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."season"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_driver" ADD CONSTRAINT "standing_driver_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_team" ADD CONSTRAINT "standing_team_season_year_season_year_fk" FOREIGN KEY ("season_year") REFERENCES "public"."season"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_team" ADD CONSTRAINT "standing_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "article_author_id_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."author"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_driver" ADD CONSTRAINT "article_driver_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_driver" ADD CONSTRAINT "article_driver_driver_id_driver_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_race" ADD CONSTRAINT "article_race_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_race" ADD CONSTRAINT "article_race_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tag" ADD CONSTRAINT "article_tag_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_tag" ADD CONSTRAINT "article_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_team" ADD CONSTRAINT "article_team_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_team" ADD CONSTRAINT "article_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_race_id_race_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."race"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved" ADD CONSTRAINT "saved_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction" ADD CONSTRAINT "prediction_season_round_race_fk" FOREIGN KEY ("season","round") REFERENCES "public"."race"("season_year","round") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_attempt" ADD CONSTRAINT "prediction_attempt_season_round_race_season_year_round_fk" FOREIGN KEY ("season","round") REFERENCES "public"."race"("season_year","round") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_audit" ADD CONSTRAINT "editorial_audit_article_id_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."article"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "race_season_round_idx" ON "race" USING btree ("season_year","round");--> statement-breakpoint
CREATE INDEX "race_date_start_idx" ON "race" USING btree ("date_start");--> statement-breakpoint
CREATE UNIQUE INDEX "session_race_kind_unique" ON "session" USING btree ("race_id","kind");--> statement-breakpoint
CREATE INDEX "session_race_idx" ON "session" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "session_openf1_idx" ON "session" USING btree ("openf1_session_key");--> statement-breakpoint
CREATE INDEX "driver_full_name_idx" ON "driver" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "driver_nationality_idx" ON "driver" USING btree ("nationality");--> statement-breakpoint
CREATE INDEX "dth_driver_season_idx" ON "driver_team_history" USING btree ("driver_id","season_year");--> statement-breakpoint
CREATE INDEX "dth_team_season_idx" ON "driver_team_history" USING btree ("team_id","season_year");--> statement-breakpoint
CREATE UNIQUE INDEX "dth_driver_team_season_unique" ON "driver_team_history" USING btree ("driver_id","team_id","season_year");--> statement-breakpoint
CREATE INDEX "team_name_idx" ON "team" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "lap_unique" ON "lap" USING btree ("race_id","driver_id","lap_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pit_unique" ON "pit_stop" USING btree ("race_id","driver_id","lap");--> statement-breakpoint
CREATE UNIQUE INDEX "qual_race_driver_unique" ON "qualifying" USING btree ("race_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "result_source_entry_unique" ON "result" USING btree ("source","source_entry_id");--> statement-breakpoint
CREATE INDEX "result_race_driver_idx" ON "result" USING btree ("race_id","driver_id");--> statement-breakpoint
CREATE INDEX "result_race_position_idx" ON "result" USING btree ("race_id","position");--> statement-breakpoint
CREATE INDEX "result_driver_idx" ON "result" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sprint_race_driver_unique" ON "sprint_result" USING btree ("race_id","driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sd_unique" ON "standing_driver" USING btree ("season_year","round","driver_id");--> statement-breakpoint
CREATE INDEX "sd_season_round_idx" ON "standing_driver" USING btree ("season_year","round");--> statement-breakpoint
CREATE UNIQUE INDEX "st_unique" ON "standing_team" USING btree ("season_year","round","team_id");--> statement-breakpoint
CREATE INDEX "st_season_round_idx" ON "standing_team" USING btree ("season_year","round");--> statement-breakpoint
CREATE INDEX "article_published_at_idx" ON "article" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "article_revision_cursor_idx" ON "article" USING btree ("updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "article_public_id_idx" ON "article" USING btree ("id") WHERE "article"."published_at" IS NOT NULL AND NOT "article"."is_premium";--> statement-breakpoint
CREATE INDEX "article_type_idx" ON "article" USING btree ("type");--> statement-breakpoint
CREATE INDEX "video_published_idx" ON "video" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "video_provider_asset_unique" ON "video" USING btree ("provider","provider_asset_id");--> statement-breakpoint
CREATE INDEX "tag_kind_idx" ON "tag" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "follow_entity_idx" ON "follow" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "event_log_ts_idx" ON "event_log" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "event_log_name_idx" ON "event_log" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "prediction_client_race_uq" ON "prediction" USING btree ("client_id","season","round");--> statement-breakpoint
CREATE INDEX "prediction_race_idx" ON "prediction" USING btree ("season","round");--> statement-breakpoint
CREATE INDEX "prediction_race_cursor_idx" ON "prediction" USING btree ("season","round","id");--> statement-breakpoint
CREATE INDEX "prediction_score_idx" ON "prediction" USING btree ("score");--> statement-breakpoint
CREATE INDEX "newsletter_edition_state_lease_idx" ON "newsletter_edition" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "prediction_attempt_created_idx" ON "prediction_attempt" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "editorial_audit_article_created_idx" ON "editorial_audit" USING btree ("article_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
