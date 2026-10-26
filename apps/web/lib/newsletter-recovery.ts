import {
  beginSourceObservation, getNewsletterEditionReview, reconcileNewsletterEdition, newsletterDeliveryIdentity,
  newsletterRecoveryScope, isNewsletterEditionKey, isNewsletterBroadcastId, isEditorialRevision,
  NewsletterRecoveryConflict, SourceObservationSupersededError, type NewsletterProviderEvidence, type NewsletterRecoveryAction,
} from '@apex/db';
import { fetchProviderJson } from './provider-json';
import { InputError } from './api-input';

export const newsletterRecoveryOperations = { begin: beginSourceObservation, load: getNewsletterEditionReview, reconcile: reconcileNewsletterEdition };
export interface NewsletterRecoveryInput { key: string; revision: string; action: NewsletterRecoveryAction; broadcastId?: string }
const STATES = ['draft', 'scheduled', 'queued', 'sent', 'canceled'] as const;
export function parseNewsletterRecoveryInput(key: string, body: Record<string, unknown>): NewsletterRecoveryInput {
  if (!isNewsletterEditionKey(key) || !isEditorialRevision(body.revision) || typeof body.action !== 'string' || !['readback', 'attach', 'confirm-sent'].includes(body.action)
    || Object.keys(body).some((field) => !['revision', 'action', 'broadcastId'].includes(field))
    || (body.action === 'attach' ? !isNewsletterBroadcastId(body.broadcastId) : Object.hasOwn(body, 'broadcastId')))
    throw new InputError('Invalid newsletter recovery request.');
  return { key, revision: body.revision, action: body.action as NewsletterRecoveryAction,
    ...(body.action === 'attach' ? { broadcastId: body.broadcastId as string } : {}) };
}

/** Strict REST readback; never infer a negative delivery result from partial fields. */
export function parseNewsletterProviderReadback(key: string, requestedId: string, value: unknown, now = Date.now()): NewsletterProviderEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider readback.');
  const row = value as Record<string, unknown>;
  const text = (field: string, maximum: number) => {
    const result = row[field];
    if (typeof result !== 'string' || Buffer.byteLength(result) > maximum) throw new Error('Invalid provider readback.');
    return result;
  };
  const nullableText = (field: string, maximum: number) => row[field] === null ? null : text(field, maximum);
  if (row.object !== 'broadcast' || row.id !== requestedId || !isNewsletterBroadcastId(row.id) || !STATES.includes(row.status as typeof STATES[number])
    || (row.name !== null && (typeof row.name !== 'string' || row.name.length > 70))) throw new Error('Invalid provider readback.');
  const audience = row.segment_id ?? row.audience_id ?? (row.segment_id === null || row.audience_id === null ? null : undefined);
  if (audience !== null && (typeof audience !== 'string' || !audience || audience.length > 256)
    || (row.segment_id != null && row.audience_id != null && row.segment_id !== row.audience_id)) throw new Error('Invalid provider readback.');
  if (row.reply_to !== null && (!Array.isArray(row.reply_to) || row.reply_to.length > 10 || row.reply_to.some((item) => typeof item !== 'string' || item.length > 254))
    || (row.topic_id !== null && (typeof row.topic_id !== 'string' || row.topic_id.length > 256))
    || !isEditorialRevision(row.created_at) || Date.parse(row.created_at) > now + 60_000
    || (row.scheduled_at !== null && !isEditorialRevision(row.scheduled_at))
    || (row.sent_at !== null && (!isEditorialRevision(row.sent_at) || Date.parse(row.sent_at) > now + 60_000 || Date.parse(row.sent_at) < Date.parse(row.created_at)))
    || (row.status === 'sent' && row.sent_at === null) || (row.status === 'scheduled' && row.scheduled_at === null)
    || (row.status === 'draft' && row.sent_at !== null)) throw new Error('Invalid provider readback.');
  const digest = newsletterDeliveryIdentity(key, { audienceId: audience, from: text('from', 512), subject: text('subject', 1_024),
    html: nullableText('html', 512_000), text: nullableText('text', 512_000), replyTo: row.reply_to as string[] | null, topicId: row.topic_id as string | null });
  return { id: requestedId, status: row.status as NewsletterProviderEvidence['status'], providerName: row.name as string | null,
    payloadHash: digest.payloadHash, createdAt: row.created_at, sentAt: row.sent_at as string | null };
}

/** Provider GET only; every positive transition is fenced again after the read. */
export async function recoverNewsletterEdition(input: NewsletterRecoveryInput, actor: string, options: {
  apiKey: string; signal?: AbortSignal; timeoutMs?: number; fetcher?: typeof fetch; operations?: typeof newsletterRecoveryOperations;
}) {
  const operations = options.operations ?? newsletterRecoveryOperations;
  options.signal?.throwIfAborted();
  const edition = await operations.load(input.key);
  if (!edition) throw new NewsletterRecoveryConflict(404);
  if (edition.revision !== input.revision || edition.leaseActive || !['creating', 'broadcast_created', 'sending', 'uncertain', 'sent'].includes(edition.state)
    || (edition.state === 'sent' && input.action !== 'readback')) throw new NewsletterRecoveryConflict(409);
  const id = input.action === 'attach' ? input.broadcastId : edition.broadcastId;
  if (!isNewsletterBroadcastId(id) || (input.action === 'attach' && (edition.broadcastId !== null || edition.identity === null)))
    throw new NewsletterRecoveryConflict(409, 'No verifiable broadcast identity is available; provider review is required.');
  options.signal?.throwIfAborted();
  const observation = await operations.begin({ source: 'resend', scope: newsletterRecoveryScope(input.key), ttlSeconds: 60 });
  const result = await fetchProviderJson(`https://api.resend.com/broadcasts/${encodeURIComponent(id)}`, {
    method: 'GET', headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' }, signal: options.signal,
  }, { timeoutMs: options.timeoutMs ?? 8_000, maxBytes: 1_048_576, fetcher: options.fetcher });
  if (!result.ok) throw new Error('Provider readback is unavailable; the edition remains blocked.');
  const evidence = parseNewsletterProviderReadback(input.key, id, result.value);
  if (edition.identity && (edition.identity.providerName !== evidence.providerName || edition.identity.payloadHash !== evidence.payloadHash))
    throw new NewsletterRecoveryConflict(409, 'Provider identity does not match the bound edition.');
  options.signal?.throwIfAborted();
  let updated;
  try { updated = await operations.reconcile({ ...input, actor, evidence, observation }); }
  catch (error) {
    // A newer operator read or an expired read lease is a fenced conflict.
    // Provider/database outages remain unavailable, with no automatic retry.
    if (error instanceof SourceObservationSupersededError) throw new NewsletterRecoveryConflict(409);
    throw error;
  }
  return { edition: updated, provider: { id: evidence.id, status: evidence.status, sentAt: evidence.sentAt }, automaticReplayAllowed: false };
}
