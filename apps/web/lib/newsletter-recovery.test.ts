import assert from 'node:assert/strict';
import test from 'node:test';
import { newsletterDeliveryIdentity, NewsletterRecoveryConflict, SourceObservationSupersededError } from '@apex/db';
import { parseNewsletterRecoveryInput, parseNewsletterProviderReadback, recoverNewsletterEdition, type newsletterRecoveryOperations } from './newsletter-recovery';

const key = `race-week-v1:2026:disposable-recovery:${'a'.repeat(24)}`;
const id = '12345678-1234-4234-8234-123456789abc';
const revision = '2026-10-04 12:00:00.123456+00';
const payload = { audienceId: 'fixture-audience', from: 'Apex <briefing@example.invalid>', subject: 'Fixture briefing', html: '<p>Fixture</p>', text: 'Fixture', replyTo: ['briefing@example.invalid'], topicId: null };
const identity = newsletterDeliveryIdentity(key, payload);
const provider = (status = 'sent') => ({ object: 'broadcast', id, name: identity.providerName, audience_id: payload.audienceId, segment_id: payload.audienceId,
  from: payload.from, subject: payload.subject, html: payload.html, text: payload.text, reply_to: payload.replyTo, topic_id: null, status,
  created_at: '2026-01-01 00:00:00+00', scheduled_at: status === 'scheduled' ? '2026-01-02 00:00:00+00' : null, sent_at: status === 'sent' ? '2026-01-02 00:00:00+00' : null });
function fixture(overrides: Record<string, unknown> = {}) {
  const state = { calls: 0, began: 0, writes: 0, evidence: null as unknown };
  const edition = { key, state: 'uncertain', broadcastId: id, revision, leaseActive: false, identity, createdAt: '2026-01-01 00:00:00+00', sentAt: null, ...overrides };
  const operations = {
    load: async () => edition,
    begin: async () => { state.began++; return { source: 'resend', scope: '', generation: '1', observationId: id }; },
    reconcile: async (input: { evidence: unknown }) => { state.writes++; state.evidence = input.evidence; return edition; },
  } as unknown as typeof newsletterRecoveryOperations;
  const fetcher: typeof fetch = async () => { state.calls++; return Response.json(provider()); };
  return { state, operations, fetcher };
}
test('edition identity binds the distinct edition, recipient target, sender, content, reply-to and topic', () => {
  assert.equal(identity.providerName.length, 69);
  assert.notEqual(newsletterDeliveryIdentity(key.replace('disposable-recovery', 'another-edition'), payload).providerName, identity.providerName);
  for (const changed of [{ audienceId: 'other' }, { from: 'other@example.invalid' }, { subject: 'other' }, { html: 'other' }, { text: 'other' }, { replyTo: ['other@example.invalid'] }, { topicId: 'other' }])
    assert.notEqual(newsletterDeliveryIdentity(key, { ...payload, ...changed }).payloadHash, identity.payloadHash);
});
test('strict operator input preserves microsecond revision and rejects extra authority or coercible actions', () => {
  assert.equal(parseNewsletterRecoveryInput(key, { revision, action: 'readback' }).revision, revision);
  for (const body of [{ revision, action: ['readback'] }, { revision, action: 'readback', actor: 'admin' }, { revision, action: 'readback', broadcastId: id }, { revision, action: 'attach' }, { revision: 'yesterday', action: 'confirm-sent' }])
    assert.throws(() => parseNewsletterRecoveryInput(key, body));
});
test('successful readback makes exactly one GET with finite no-redirect transport and sanitized evidence', async () => {
  const f = fixture();
  const fetcher: typeof fetch = async (_url, init) => {
    f.state.calls++; assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    return Response.json(provider());
  };
  const result = await recoverNewsletterEdition({ key, revision, action: 'confirm-sent' }, 'operator', { apiKey: 'fixture', operations: f.operations, fetcher });
  assert.equal(f.state.calls, 1); assert.equal(f.state.began, 1); assert.equal(f.state.writes, 1); assert.equal(result.automaticReplayAllowed, false);
  assert.ok(!JSON.stringify(f.state.evidence).includes(payload.html)); assert.ok(!JSON.stringify(f.state.evidence).includes(payload.from));
});
test('active attempts and exact microsecond stale revisions are refused before observations or HTTP reads', async () => {
  for (const overrides of [{ leaseActive: true }, { revision: revision.replace('123456', '123457') }]) {
    const f = fixture(overrides);
    await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'readback' }, 'operator', { apiKey: 'fixture', ...f }), NewsletterRecoveryConflict);
    assert.equal(f.state.calls, 0); assert.equal(f.state.began, 0); assert.equal(f.state.writes, 0);
  }
});
test('a legacy orphan without bound identity remains review-required even with a supplied candidate', async () => {
  const f = fixture({ identity: null, broadcastId: null });
  await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'attach', broadcastId: id }, 'operator', { apiKey: 'fixture', ...f }), NewsletterRecoveryConflict);
  assert.equal(f.state.calls, 0); assert.equal(f.state.writes, 0);
});
test('legacy known exact broadcast identity can be read without inventing missing historical payload metadata', async () => {
  const f = fixture({ identity: null });
  await recoverNewsletterEdition({ key, revision, action: 'readback' }, 'operator', { apiKey: 'fixture', ...f });
  assert.equal(f.state.calls, 1); assert.equal(f.state.writes, 1);
});
test('documented nullable legacy fields retain null identity and cannot match a bound current payload', async () => {
  const value = { ...provider(), reply_to: null, html: null, text: null, segment_id: null, audience_id: null };
  const parsed = parseNewsletterProviderReadback(key, id, value);
  assert.notEqual(parsed.payloadHash, identity.payloadHash);
  const legacy = fixture({ identity: null });
  await recoverNewsletterEdition({ key, revision, action: 'confirm-sent' }, 'operator', { apiKey: 'fixture', operations: legacy.operations, fetcher: async () => Response.json(value) });
  assert.equal(legacy.state.writes, 1);
  const bound = fixture();
  await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'confirm-sent' }, 'operator', { apiKey: 'fixture', operations: bound.operations, fetcher: async () => Response.json(value) }), NewsletterRecoveryConflict);
  assert.equal(bound.state.writes, 0);
});
test('foreign ID, marker, recipient target and content cannot commit reconciliation', async () => {
  for (const changes of [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, { name: 'other' }, { segment_id: 'foreign' }, { html: 'foreign' }]) {
    const f = fixture();
    await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'readback' }, 'operator', { apiKey: 'fixture', operations: f.operations, fetcher: async () => Response.json({ ...provider(), ...changes }) }));
    assert.equal(f.state.writes, 0);
  }
});
test('missing fields, unknown status, wrong timestamps and partial JSON do not become sent evidence', () => {
  for (const changes of [{ object: undefined }, { reply_to: undefined }, { status: 'failed' }, { sent_at: null }, { created_at: '2026-02-30 00:00:00+00' }, { scheduled_at: 'tomorrow' }])
    assert.throws(() => parseNewsletterProviderReadback(key, id, { ...provider(), ...changes }));
  for (const status of ['draft', 'scheduled', 'queued', 'canceled']) assert.equal(parseNewsletterProviderReadback(key, id, provider(status)).status, status);
});
test('404, 503, malformed and hung readback preserve every stored edition transition', async () => {
  for (const fetcher of [async () => new Response(null, { status: 404 }), async () => new Response(null, { status: 503 }), async () => new Response('{broken'), () => new Promise<Response>(() => {})]) {
    const f = fixture();
    await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'readback' }, 'operator', { apiKey: 'fixture', operations: f.operations, fetcher, timeoutMs: 15 }));
    assert.equal(f.state.writes, 0);
  }
});

test('separate concurrent operator observations yield one confirmation and a typed 409 without retrying a superseded read', async () => {
  const f = fixture(); let generation = 0, gets = 0, commits = 0;
  let release!: () => void;
  const bothReads = new Promise<void>((resolve) => { release = resolve; });
  const operations = {
    ...f.operations,
    begin: async () => ({ source: 'resend', scope: '', generation: String(++generation), observationId: id }),
    reconcile: async (input: { observation: { generation: string } }) => {
      if (input.observation.generation !== String(generation)) throw new SourceObservationSupersededError();
      commits++; return { ...(await f.operations.load(key))!, state: 'sent' };
    },
  } as unknown as typeof newsletterRecoveryOperations;
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.method, 'GET'); if (++gets === 2) release(); await bothReads; return Response.json(provider());
  };
  const outcomes = await Promise.allSettled([1, 2].map(() => recoverNewsletterEdition({ key, revision, action: 'confirm-sent' }, 'operator', {
    apiKey: 'fixture', operations, fetcher,
  })));
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  const loser = outcomes.find((item) => item.status === 'rejected');
  assert.ok(loser && loser.status === 'rejected'); assert.ok(loser.reason instanceof NewsletterRecoveryConflict); assert.equal(loser.reason.status, 409);
  assert.equal(gets, 2); assert.equal(generation, 2); assert.equal(commits, 1);
});

test('expired observation is a conflict while unrelated storage errors remain unavailable and are not retried', async () => {
  for (const expected of [new SourceObservationSupersededError(), new Error('Storage unavailable')]) {
    const f = fixture(); let reconciles = 0;
    const operations = { ...f.operations, reconcile: async () => { reconciles++; throw expected; } };
    await assert.rejects(recoverNewsletterEdition({ key, revision, action: 'readback' }, 'operator', { apiKey: 'fixture', operations, fetcher: f.fetcher }),
      (error: unknown) => expected instanceof SourceObservationSupersededError
        ? error instanceof NewsletterRecoveryConflict && error.status === 409 : error === expected);
    assert.equal(f.state.calls, 1); assert.equal(reconciles, 1); assert.equal(f.state.writes, 0);
  }
});
