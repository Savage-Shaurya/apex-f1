import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getWorkerDb } from './client';

export type NewsletterReservation =
  | { status: 'acquired'; leaseToken: string; broadcastId: string | null }
  | { status: 'already-sent' | 'in-progress' | 'needs-review'; broadcastId: string | null };
const LEASE_SECONDS = 300;

function ledger(key: string) {
  if (!process.env.DATABASE_URL) throw new Error('Newsletter ledger is not configured.');
  if (!key.trim() || key.length > 512) throw new Error('Invalid newsletter edition key.');
  return getWorkerDb();
}

/** No automatic recovery from a provider-operation intent or ambiguous result. */
export async function reserveNewsletterEdition(key: string): Promise<NewsletterReservation> {
  const db = ledger(key);
  const token = randomUUID();
  const claimed = await db.execute(sql`
    insert into newsletter_edition (edition_key, state, attempt_id, lease_expires_at)
    values (${key}, 'reserved', ${token}::uuid, clock_timestamp() + ${LEASE_SECONDS} * interval '1 second')
    on conflict (edition_key) do update
    set state = 'reserved', attempt_id = excluded.attempt_id,
      delivery_identity = null,
      lease_expires_at = excluded.lease_expires_at, error = null, error_at = null, updated_at = clock_timestamp()
    where newsletter_edition.broadcast_id is null and
      (newsletter_edition.state = 'failed' or
       (newsletter_edition.state = 'reserved' and newsletter_edition.lease_expires_at < clock_timestamp()))
    returning edition_key
  `);
  if (claimed.length) return { status: 'acquired', leaseToken: token, broadcastId: null };
  const rows = await db.execute(sql`select state, broadcast_id, lease_expires_at > clock_timestamp() as active
    from newsletter_edition where edition_key = ${key}`);
  const row = rows[0];
  if (!row) throw new Error('Newsletter reservation could not be verified.');
  const broadcastId = typeof row.broadcast_id === 'string' ? row.broadcast_id : null;
  if (row.state === 'sent') return { status: 'already-sent', broadcastId };
  if (row.state === 'reserved' && row.active === true) return { status: 'in-progress', broadcastId };
  return { status: 'needs-review', broadcastId };
}

async function requireTransition(key: string, statement: ReturnType<typeof sql>) {
  const rows = await ledger(key).execute(statement);
  if (!rows.length) throw new Error('Newsletter lease or state changed; operator review may be required.');
}

/** Persist intent before HTTP create, so a crash cannot create a second edition. */
export async function markNewsletterCreating(key: string, leaseToken: string): Promise<void> {
  await requireTransition(key, sql`update newsletter_edition set state = 'creating', updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${leaseToken}::uuid and state = 'reserved'
      and lease_expires_at > clock_timestamp() returning edition_key`);
}
export async function recordNewsletterBroadcast(key: string, id: string, leaseToken: string): Promise<void> {
  if (!id.trim() || id.length > 256) throw new Error('Invalid provider broadcast identity.');
  await requireTransition(key, sql`update newsletter_edition set state = 'broadcast_created', broadcast_id = ${id},
      broadcast_created_at = clock_timestamp(), updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${leaseToken}::uuid and state = 'creating' returning edition_key`);
}
export async function markNewsletterSending(key: string, leaseToken: string): Promise<void> {
  await requireTransition(key, sql`update newsletter_edition set state = 'sending', sending_at = clock_timestamp(), updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${leaseToken}::uuid and state = 'broadcast_created'
      and broadcast_id is not null and lease_expires_at > clock_timestamp() returning edition_key`);
}
export async function markNewsletterSent(key: string, leaseToken: string): Promise<void> {
  await requireTransition(key, sql`update newsletter_edition set state = 'sent', sent_at = clock_timestamp(), updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${leaseToken}::uuid and state = 'sending' returning edition_key`);
}
export async function markNewsletterFailed(key: string, reason: string, leaseToken: string, options: { uncertain?: boolean } = {}): Promise<void> {
  const state = options.uncertain ? 'uncertain' : 'failed';
  await requireTransition(key, sql`update newsletter_edition set state = ${state}, error = ${reason.slice(0, 1000)},
      error_at = clock_timestamp(), updated_at = clock_timestamp()
    where edition_key = ${key} and attempt_id = ${leaseToken}::uuid and state <> 'sent' returning edition_key`);
}
