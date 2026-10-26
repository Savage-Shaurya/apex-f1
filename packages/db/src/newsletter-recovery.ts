import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getWorkerDb } from './client';
import { withSourceObservation, completeSourceObservation, type SourceObservation } from './source-observation';
import { isEditorialRevision } from './editorial';
import type { NewsletterDeliveryIdentity } from './schema/newsletter_edition';

export interface NewsletterIdentityPayload { audienceId: string | null; from: string; subject: string; html: string | null; text: string | null; replyTo: string[] | null; topicId: string | null }
export interface NewsletterEditionReview {
  key: string; state: string; broadcastId: string | null; revision: string; leaseActive: boolean;
  identity: NewsletterDeliveryIdentity | null; createdAt: string; sentAt: string | null;
}
export type NewsletterRecoveryAction = 'readback' | 'attach' | 'confirm-sent';
export interface NewsletterProviderEvidence {
  id: string; status: 'draft' | 'scheduled' | 'queued' | 'sent' | 'canceled';
  providerName: string | null; payloadHash: string; createdAt: string; sentAt: string | null;
}
export class NewsletterRecoveryConflict extends Error {
  constructor(readonly status: 404 | 409, message = 'Newsletter edition changed or requires manual provider review.') { super(message); }
}
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function isNewsletterEditionKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && /^race-week-v1:(?:19[5-9]\d|20\d{2}):[a-z0-9][a-z0-9_-]{0,159}:[a-f0-9]{24}$/.test(value);
}
export function isNewsletterBroadcastId(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
export function newsletterRecoveryScope(key: string): string {
  if (!isNewsletterEditionKey(key)) throw new TypeError('Invalid newsletter edition identity.');
  return `newsletter-reconcile:${createHash('sha256').update(key).digest('hex')}`;
}
export function newsletterDeliveryIdentity(key: string, payload: NewsletterIdentityPayload): NewsletterDeliveryIdentity {
  return { version: 1, providerName: `apex:${createHash('sha256').update(key).digest('hex')}`,
    payloadHash: createHash('sha256').update(JSON.stringify([payload.audienceId, payload.from, payload.subject, payload.html, payload.text, payload.replyTo, payload.topicId])).digest('hex') };
}
function identity(value: unknown): NewsletterDeliveryIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && row.version === 1 && typeof row.providerName === 'string' && /^apex:[a-f0-9]{64}$/.test(row.providerName)
    && typeof row.payloadHash === 'string' && HEX.test(row.payloadHash) ? row as unknown as NewsletterDeliveryIdentity : null;
}
function review(row: Record<string, unknown>): NewsletterEditionReview {
  return { key: String(row.edition_key), state: String(row.state), broadcastId: typeof row.broadcast_id === 'string' ? row.broadcast_id : null,
    revision: String(row.revision), leaseActive: row.lease_active === true, identity: identity(row.delivery_identity), createdAt: String(row.created_at), sentAt: typeof row.sent_at === 'string' ? row.sent_at : null };
}
const FIELDS = sql`edition_key, state, broadcast_id, updated_at::text as revision, created_at::text as created_at,
  sent_at::text as sent_at, delivery_identity, lease_expires_at > clock_timestamp() as lease_active`;

/** Bind the exact create payload before provider intent; no recipients/content enter the ledger. */
export async function recordNewsletterDeliveryIdentity(key: string, token: string, value: NewsletterDeliveryIdentity): Promise<void> {
  if (!isNewsletterEditionKey(key) || !UUID.test(token) || !identity(value) || value.providerName !== `apex:${createHash('sha256').update(key).digest('hex')}`)
    throw new TypeError('Invalid newsletter delivery identity.');
  const rows = await getWorkerDb().execute(sql`update newsletter_edition set delivery_identity = ${JSON.stringify(value)}::text::jsonb, updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${token}::uuid and state = 'reserved' and lease_expires_at > clock_timestamp()
      and (delivery_identity is null or delivery_identity = ${JSON.stringify(value)}::text::jsonb) returning edition_key`);
  if (rows.length !== 1) throw new NewsletterRecoveryConflict(409);
}
export async function getNewsletterEditionReview(key: string): Promise<NewsletterEditionReview | null> {
  if (!isNewsletterEditionKey(key)) throw new TypeError('Invalid newsletter edition identity.');
  const rows = await getWorkerDb().execute(sql`select ${FIELDS} from newsletter_edition where edition_key = ${key} limit 1`);
  return rows[0] ? review(rows[0]) : null;
}
export async function listNewsletterEditionReviews(limit = 25, before?: string): Promise<{ editions: NewsletterEditionReview[]; next: string | null }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || (before !== undefined && !isNewsletterEditionKey(before))) throw new TypeError('Invalid newsletter pagination.');
  const rows = await getWorkerDb().execute(sql`select ${FIELDS} from newsletter_edition
    ${before ? sql`where edition_key < ${before}` : sql``} order by edition_key desc limit ${limit + 1}`);
  const editions = rows.slice(0, limit).map(review);
  return { editions, next: rows.length > limit ? editions.at(-1)!.key : null };
}
export async function listNewsletterRecoveryAudit(key: string) {
  const scope = newsletterRecoveryScope(key);
  const rows = await getWorkerDb().execute(sql`select id, recorded_at::text as recorded_at, summary from source_snapshot_event
    where source = 'resend' and scope = ${scope} order by recorded_at desc, id desc limit 25`);
  return rows.map((row) => ({ id: String(row.id), recordedAt: String(row.recorded_at), summary: row.summary }));
}

/** Exact locked CAS and pre-read observation; no branch releases an edition for replay. */
export async function reconcileNewsletterEdition(input: {
  key: string; revision: string; actor: string; action: NewsletterRecoveryAction; evidence: NewsletterProviderEvidence; observation: SourceObservation;
}): Promise<NewsletterEditionReview> {
  const { key, revision, actor, action, evidence, observation } = input;
  if (!isNewsletterEditionKey(key) || !isEditorialRevision(revision) || !/^[a-z][a-z0-9._-]{0,63}$/.test(actor)
    || !['readback', 'attach', 'confirm-sent'].includes(action) || !isNewsletterBroadcastId(evidence.id)
    || !['draft', 'scheduled', 'queued', 'sent', 'canceled'].includes(evidence.status)
    || (evidence.providerName !== null && (typeof evidence.providerName !== 'string' || evidence.providerName.length > 70)) || !HEX.test(evidence.payloadHash)
    || !isEditorialRevision(evidence.createdAt) || (evidence.sentAt !== null && !isEditorialRevision(evidence.sentAt))
    || (evidence.status === 'sent' && evidence.sentAt === null)
    || observation.source !== 'resend' || observation.scope !== newsletterRecoveryScope(key)) throw new TypeError('Invalid newsletter reconciliation.');
  return withSourceObservation(observation, async (tx) => {
    const rows = await tx.execute(sql`select ${FIELDS}, attempt_id::text as attempt_id from newsletter_edition where edition_key = ${key} for update`);
    const row = rows[0];
    if (!row) throw new NewsletterRecoveryConflict(404);
    const prior = review(row);
    if (prior.revision !== revision || prior.leaseActive || !['creating', 'broadcast_created', 'sending', 'uncertain', 'sent'].includes(prior.state)
      || (prior.state === 'sent' && action !== 'readback')
      || (prior.state === 'sent' && evidence.status !== 'sent')
      || (prior.identity !== null && (prior.identity.providerName !== evidence.providerName || prior.identity.payloadHash !== evidence.payloadHash))
      || (prior.identity === null && prior.broadcastId === null)
      || (prior.broadcastId !== null && prior.broadcastId !== evidence.id)
      || (action === 'attach' ? prior.broadcastId !== null : prior.broadcastId === null)) throw new NewsletterRecoveryConflict(409);
    if (action === 'confirm-sent' && evidence.status !== 'sent') throw new NewsletterRecoveryConflict(409, 'Provider has not verified this broadcast as sent.');
    let next = prior;
    if (action !== 'readback') {
      const changed = await tx.execute(sql`update newsletter_edition set broadcast_id = ${evidence.id},
        state = ${action === 'confirm-sent' ? 'sent' : 'uncertain'},
        sent_at = ${action === 'confirm-sent' ? sql`${evidence.sentAt}::text::timestamptz` : sql`sent_at`},
        updated_at = clock_timestamp()
        where edition_key = ${key} and updated_at = ${revision}::text::timestamptz and attempt_id = ${String(row.attempt_id)}::uuid
          and state = ${prior.state} returning ${FIELDS}`);
      if (changed.length !== 1) throw new NewsletterRecoveryConflict(409);
      next = review(changed[0]!);
    }
    const summary = { actor, operation: action, previousRevision: prior.revision, revision: next.revision,
      previousState: prior.state, state: next.state, providerId: evidence.id, providerStatus: evidence.status,
      providerName: evidence.providerName, payloadHash: evidence.payloadHash,
      providerCreatedAt: evidence.createdAt, providerSentAt: evidence.sentAt,
      identityVerified: prior.identity ? 'payload-hash-and-id' : 'stored-id', automaticReplayAllowed: false };
    await tx.execute(sql`insert into source_snapshot_event (source, scope, generation, observation_id, summary)
      values (${observation.source}, ${observation.scope}, ${observation.generation}::bigint, ${observation.observationId}::uuid, ${JSON.stringify(summary)}::text::jsonb)`);
    await completeSourceObservation(tx, observation, evidence.payloadHash, { lastRecovery: summary });
    return next;
  });
}
