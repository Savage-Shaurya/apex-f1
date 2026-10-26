ALTER TABLE "newsletter_edition" ADD COLUMN "delivery_identity" jsonb;--> statement-breakpoint
ALTER TABLE "newsletter_edition" ADD CONSTRAINT "newsletter_edition_delivery_identity_check" CHECK ("newsletter_edition"."delivery_identity" IS NULL OR (
        jsonb_typeof("newsletter_edition"."delivery_identity") = 'object'
        AND "newsletter_edition"."delivery_identity" ?& ARRAY['version','providerName','payloadHash']
        AND ("newsletter_edition"."delivery_identity" - 'version' - 'providerName' - 'payloadHash') = '{}'::jsonb
        AND "newsletter_edition"."delivery_identity"->'version' = '1'::jsonb
        AND jsonb_typeof("newsletter_edition"."delivery_identity"->'providerName') = 'string'
        AND "newsletter_edition"."delivery_identity"->>'providerName' ~ '^apex:[0-9a-f]{64}$'
        AND jsonb_typeof("newsletter_edition"."delivery_identity"->'payloadHash') = 'string'
        AND "newsletter_edition"."delivery_identity"->>'payloadHash' ~ '^[0-9a-f]{64}$'
      ));