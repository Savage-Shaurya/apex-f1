import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverNewsletterEdition, NewsletterDeliveryError, type NewsletterLedger } from './newsletter-delivery';

const input = { key: 'disposable-edition', apiKey: 'synthetic-provider-key', audienceId: 'synthetic-audience', fromEmail: 'fixture@example.invalid', fromName: 'Fixture', email: { subject: 'Test', html: 'Test', text: 'Test' } };
function fixture() {
  const states: string[] = [];
  const ledger: NewsletterLedger = {
    reserveNewsletterEdition: async () => ({ status: 'acquired', leaseToken: 'fixture-lease', broadcastId: null }),
    markNewsletterCreating: async () => { states.push('creating'); },
    recordNewsletterBroadcast: async () => { states.push('record-id'); },
    markNewsletterSending: async () => { states.push('sending'); },
    markNewsletterSent: async () => { states.push('sent'); },
    markNewsletterFailed: async (_key, _reason, _token, options) => { states.push(options?.uncertain ? 'uncertain' : 'failed'); },
  };
  return { ledger, states };
}

test('newsletter creation has a whole-body deadline; a lost create acknowledgement cannot become sent', async () => {
  const setup = fixture(); let calls = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    calls++; assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); } }));
  };
  await assert.rejects(deliverNewsletterEdition({ ...input, timeoutMs: 10 }, setup.ledger, fetcher), (error: unknown) => error instanceof NewsletterDeliveryError && error.uncertain);
  assert.equal(calls, 1); assert.deepEqual(setup.states, ['creating', 'uncertain']);
});

test('oversized create acknowledgement remains uncertain and never triggers a send', async () => {
  const setup = fixture(); let calls = 0;
  await assert.rejects(deliverNewsletterEdition(input, setup.ledger, async () => { calls++; return Response.json({ id: 'valid-id', extra: 'x'.repeat(10_000) }); }), (error: unknown) => error instanceof NewsletterDeliveryError && error.uncertain);
  assert.equal(calls, 1); assert.deepEqual(setup.states, ['creating', 'uncertain']);
});

test('accepted send acknowledges status without waiting on an irrelevant hung body', async () => {
  const setup = fixture(); let calls = 0; let canceled = false;
  const result = await deliverNewsletterEdition(input, setup.ledger, async () => {
    calls++;
    if (calls === 1) return Response.json({ id: 'valid-id' });
    return new Response(new ReadableStream({ cancel() { canceled = true; } }), { status: 202 });
  });
  assert.deepEqual(result, { status: 'sent', broadcastId: 'valid-id' });
  assert.deepEqual(setup.states, ['creating', 'record-id', 'sending', 'sent']);
  assert.equal(canceled, true);
});

test('job cancellation during remote create preserves uncertainty and prevents an automatic send', async () => {
  const setup = fixture(); const controller = new AbortController();
  const pending = deliverNewsletterEdition({ ...input, signal: controller.signal }, setup.ledger, async () => {
    controller.abort(new Error('job ended'));
    return new Promise<Response>(() => {});
  });
  await assert.rejects(pending, (error: unknown) => error instanceof NewsletterDeliveryError && error.uncertain);
  assert.deepEqual(setup.states, ['creating', 'uncertain']);
});

test('an already sent durable edition performs no remote requests', async () => {
  const setup = fixture();
  setup.ledger.reserveNewsletterEdition = async () => ({ status: 'already-sent', broadcastId: 'existing-id' });
  assert.deepEqual(await deliverNewsletterEdition(input, setup.ledger, async () => assert.fail('duplicate remote send')), { status: 'already-sent', broadcastId: 'existing-id' });
  assert.deepEqual(setup.states, []);
});
