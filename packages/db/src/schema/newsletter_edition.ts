import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, index, check, jsonb } from 'drizzle-orm/pg-core';

/** Bound before provider create; contains no recipients, body or credentials. */
export interface NewsletterDeliveryIdentity {
  version: 1;
  providerName: string;
  payloadHash: string;
}

export const newsletterEditionStates = [
  'reserved',
  'creating',
  'broadcast_created',
  'sending',
  'sent',
  'failed',
  'uncertain',
] as const;

/** Durable, private provider-operation ledger. Never infer failure from a timeout. */
export const newsletterEdition = pgTable(
  'newsletter_edition',
  {
    // Deterministic edition identity must be supplied by the caller, not random.
    key: text('edition_key').primaryKey(),
    state: text('state', { enum: newsletterEditionStates }).notNull().default('reserved'),
    broadcastId: text('broadcast_id'),
    deliveryIdentity: jsonb('delivery_identity').$type<NewsletterDeliveryIdentity>(),
    // Compare this lease token on every transition to reject a stale worker.
    attemptId: uuid('attempt_id').notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    error: text('error'),
    errorAt: timestamp('error_at', { withTimezone: true }),
    broadcastCreatedAt: timestamp('broadcast_created_at', { withTimezone: true }),
    sendingAt: timestamp('sending_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    stateLeaseIdx: index('newsletter_edition_state_lease_idx').on(t.state, t.leaseExpiresAt),
    keyCheck: check('newsletter_edition_key_check', sql`length(btrim(${t.key})) > 0`),
    stateCheck: check(
      'newsletter_edition_state_check',
      sql`${t.state} IN ('reserved', 'creating', 'broadcast_created', 'sending', 'sent', 'failed', 'uncertain')`,
    ),
    broadcastCheck: check(
      'newsletter_edition_broadcast_check',
      sql`${t.state} NOT IN ('broadcast_created', 'sending', 'sent')
        OR (${t.broadcastId} IS NOT NULL AND length(btrim(${t.broadcastId})) > 0)`,
    ),
    activeLeaseCheck: check(
      'newsletter_edition_active_lease_check',
      sql`${t.state} NOT IN ('reserved', 'creating', 'broadcast_created', 'sending') OR ${t.leaseExpiresAt} IS NOT NULL`,
    ),
    sentCheck: check(
      'newsletter_edition_sent_check',
      sql`${t.state} <> 'sent' OR ${t.sentAt} IS NOT NULL`,
    ),
    deliveryIdentityCheck: check(
      'newsletter_edition_delivery_identity_check',
      sql`${t.deliveryIdentity} IS NULL OR (
        jsonb_typeof(${t.deliveryIdentity}) = 'object'
        AND ${t.deliveryIdentity} ?& ARRAY['version','providerName','payloadHash']
        AND (${t.deliveryIdentity} - 'version' - 'providerName' - 'payloadHash') = '{}'::jsonb
        AND ${t.deliveryIdentity}->'version' = '1'::jsonb
        AND jsonb_typeof(${t.deliveryIdentity}->'providerName') = 'string'
        AND ${t.deliveryIdentity}->>'providerName' ~ '^apex:[0-9a-f]{64}$'
        AND jsonb_typeof(${t.deliveryIdentity}->'payloadHash') = 'string'
        AND ${t.deliveryIdentity}->>'payloadHash' ~ '^[0-9a-f]{64}$'
      )`,
    ),
  }),
).enableRLS();

export type NewsletterEdition = typeof newsletterEdition.$inferSelect;
export type NewNewsletterEdition = typeof newsletterEdition.$inferInsert;
