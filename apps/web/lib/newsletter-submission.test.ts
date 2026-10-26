import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import {
  NEWSLETTER_SUBMISSION_DEADLINE_MS,
  newsletterFailureFeedback,
  submitNewsletter,
} from './newsletter-submission';

test('subscription success requires the real endpoint contract and sends one trimmed address', async () => {
  let attempts = 0;
  const result = await submitNewsletter('  reader@example.com  ', {
    fetchImpl: async (url, init) => {
      attempts += 1;
      assert.equal(url, '/api/newsletter');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(String(init?.body)), { email: 'reader@example.com' });
      assert.equal(init?.signal?.aborted, false);
      return Response.json({ ok: true, mode: 'resend', welcomeStatus: 'sent' });
    },
  });
  assert.deepEqual(result, { kind: 'accepted', duplicate: false, welcomeStatus: 'sent' });
  assert.equal(attempts, 1);
});

test('confirmed duplicates and unavailable welcome mail do not claim a welcome email was sent', async () => {
  const result = await submitNewsletter('reader@example.com', {
    fetchImpl: async () => Response.json({ ok: true, mode: 'resend', duplicate: true, welcomeStatus: 'not-requested' }),
  });
  assert.deepEqual(result, { kind: 'accepted', duplicate: true, welcomeStatus: 'unavailable' });
  const failedWelcome = await submitNewsletter('reader@example.com', {
    fetchImpl: async () => Response.json({ ok: true, mode: 'resend', welcomeStatus: 'failed' }),
  });
  assert.deepEqual(failedWelcome, { kind: 'accepted', duplicate: false, welcomeStatus: 'failed' });
});

test('HTTP rejection cannot become success even with an accepted-looking body', async () => {
  for (const status of [400, 409, 429, 503]) {
    const result = await submitNewsletter('reader@example.com', {
      fetchImpl: async () => Response.json({ ok: true, mode: 'resend' }, { status }),
    });
    assert.deepEqual(result, { kind: 'rejected', status });
    assert.notEqual(newsletterFailureFeedback({ kind: 'rejected', status }), '');
  }
});

test('malformed or unconfirmed successful responses never fabricate acceptance', async () => {
  for (const payload of [null, {}, { ok: false, mode: 'resend' }, { ok: true }, { ok: true, mode: 'queue' }]) {
    assert.deepEqual(await submitNewsletter('reader@example.com', {
      fetchImpl: async () => Response.json(payload),
    }), { kind: 'uncertain', reason: 'invalid-response' });
  }
  assert.deepEqual(await submitNewsletter('reader@example.com', {
    fetchImpl: async () => new Response('not JSON', { status: 200 }),
  }), { kind: 'uncertain', reason: 'invalid-response' });
});

test('network failure reports uncertainty and makes no automatic retry', async () => {
  let attempts = 0;
  const result = await submitNewsletter('reader@example.com', {
    fetchImpl: async () => { attempts += 1; throw new TypeError('connection lost'); },
  });
  assert.deepEqual(result, { kind: 'uncertain', reason: 'network' });
  assert.equal(attempts, 1);
  assert.match(newsletterFailureFeedback(result), /may have completed/);
});

test('a fetch that ignores abort still settles at the deadline with no retry or false success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal: AbortSignal | null | undefined;
  let attempts = 0;
  let finishRequest!: (response: Response) => void;
  const pending = submitNewsletter('reader@example.com', {
    fetchImpl: (_, init) => {
      attempts += 1;
      requestSignal = init?.signal;
      return new Promise<Response>((resolve) => { finishRequest = resolve; });
    },
  });
  t.mock.timers.tick(NEWSLETTER_SUBMISSION_DEADLINE_MS - 1);
  assert.equal(requestSignal?.aborted, false);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.deepEqual(result, { kind: 'uncertain', reason: 'timeout' });
  assert.equal(requestSignal?.aborted, true);
  assert.equal(attempts, 1);
  assert.match(newsletterFailureFeedback(result), /may have completed.*could not confirm/);
  finishRequest(Response.json({ ok: true, mode: 'resend', welcomeStatus: 'sent' }));
  assert.deepEqual(await pending, { kind: 'uncertain', reason: 'timeout' });
});

test('the same deadline covers an unfinished JSON body after HTTP success', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let decoding = false;
  const pending = submitNewsletter('reader@example.com', {
    fetchImpl: async () => ({
      ok: true,
      json: () => { decoding = true; return new Promise<unknown>(() => {}); },
    }) as Response,
  });
  await Promise.resolve();
  assert.equal(decoding, true);
  t.mock.timers.tick(NEWSLETTER_SUBMISSION_DEADLINE_MS);
  assert.deepEqual(await pending, { kind: 'uncertain', reason: 'timeout' });
});

test('an already-cancelled form never starts a subscription request', async () => {
  const controller = new AbortController();
  controller.abort();
  let attempts = 0;
  assert.deepEqual(await submitNewsletter('reader@example.com', {
    signal: controller.signal,
    fetchImpl: async () => { attempts += 1; return Response.json({ ok: true, mode: 'resend' }); },
  }), { kind: 'cancelled' });
  assert.equal(attempts, 0);
});

test('unmount cancellation aborts transport, removes its listener and ignores late acceptance', async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  let finishRequest!: (response: Response) => void;
  const pending = submitNewsletter('reader@example.com', {
    signal: controller.signal,
    fetchImpl: (_, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>((resolve) => { finishRequest = resolve; });
    },
  });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort();
  assert.deepEqual(await pending, { kind: 'cancelled' });
  assert.equal(requestSignal?.aborted, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  finishRequest(Response.json({ ok: true, mode: 'resend' }));
  assert.deepEqual(await pending, { kind: 'cancelled' });
});

test('successful completion clears the deadline and external cancellation listener', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  const result = await submitNewsletter('reader@example.com', {
    signal: controller.signal,
    fetchImpl: async (_, init) => {
      requestSignal = init?.signal;
      return Response.json({ ok: true, mode: 'resend' });
    },
  });
  assert.equal(result.kind, 'accepted');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(NEWSLETTER_SUBMISSION_DEADLINE_MS);
  controller.abort();
  assert.equal(requestSignal?.aborted, false);
});
