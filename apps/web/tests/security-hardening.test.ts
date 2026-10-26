import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorResponse, InputError, readJsonObject, safeErrorMessage } from '../lib/api-input';
import { tooMany } from '../lib/rate-limit';

function streamed(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  return new Request('http://127.0.0.1/api/test', {
    method: 'POST', body, signal, duplex: 'half',
  } as RequestInit);
}

test('upload deadline remains finite when cancellation itself never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  });
  const pending = readJsonObject(streamed(body));
  await Promise.resolve();
  t.mock.timers.tick(5_000);
  await assert.rejects(pending, (error: unknown) => error instanceof InputError && error.status === 408);
  assert.equal(cancelled, true);
});

test('disconnected and already-aborted requests stop unfinished body reads immediately', async () => {
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    if (alreadyAborted) controller.abort();
    const pending = readJsonObject(streamed(body, controller.signal));
    if (!alreadyAborted) controller.abort();
    await assert.rejects(pending, /request was cancelled/);
    assert.equal(cancelled, true);
  }
});

test('invalid parser policies fail before acquiring an upload reader', async () => {
  for (const maximum of [0, -1, 1.5, Number.NaN, 1_048_577]) {
    await assert.rejects(readJsonObject(new Request('http://127.0.0.1'), maximum), /Invalid request body limit/);
  }
});

test('mutation rejection and exhausted quota responses are private and noncacheable', () => {
  assert.equal(errorResponse(new InputError('invalid email')).headers.get('cache-control'), 'private, no-store');
  assert.equal(tooMany({ ok: false, limit: 5, remaining: 0, resetAt: 10_000, retryAfter: 5 }).headers.get('cache-control'), 'private, no-store');
});

test('operator errors redact credential URLs and bearer values even when not configured locally', () => {
  const message = safeErrorMessage(new Error('failed https://worker:secret@service.invalid/path and redis://cache:password@cache.invalid/0; Bearer abc.secret-token'));
  assert.equal(message.includes('secret@'), false);
  assert.equal(message.includes('password@'), false);
  assert.equal(message.includes('abc.secret-token'), false);
  assert.match(message, /\[credential URL\]/);
  assert.match(message, /Bearer \[redacted\]/);
});
