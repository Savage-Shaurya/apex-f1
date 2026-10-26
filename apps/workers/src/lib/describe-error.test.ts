import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeError } from './describe-error';

/** Same shape as @apex/api-client's ProviderError (provider, code, status). */
class ProviderError extends Error {
  constructor(readonly provider: string, readonly code: string, readonly status?: number) { super(`${provider}: ${code}`); this.name = 'ProviderError'; }
}

test('R3-BE-2: describeError keeps the error class and codes, never messages, hosts or secrets', () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9 postgres://user:secret@db.example/apex'), { code: 'ECONNREFUSED', errno: -61, syscall: 'connect' });
  const text = describeError(refused);
  assert.equal(text, 'Error code=ECONNREFUSED');
  assert.doesNotMatch(text, /127\.0\.0\.1|secret|db\.example/);
  assert.equal(describeError(new ProviderError('jolpica', 'http', 503)), 'ProviderError provider=jolpica code=http status=503');
  const pg = Object.assign(new Error('canceling statement due to statement timeout'), { name: 'PostgresError', code: '57014' });
  const wrapped = new Error('Failed query: select * from job_lease where token = $1', { cause: pg });
  assert.equal(describeError(wrapped), 'Error <- PostgresError code=57014');
  assert.equal(describeError(new AggregateError([refused], 'all failed')), 'AggregateError <- Error code=ECONNREFUSED');
  assert.equal(describeError('boom'), 'non-Error string thrown');
  assert.equal(describeError(undefined), 'unknown error');
  assert.equal(describeError(Object.assign(new Error('x'), { code: 'https://evil.example/x?token=1' })), 'Error');
});

test('R3-BE-2: current-season sync error lines carry the redacted cause', async () => {
  const { errorMessage } = await import('./current-season-sync');
  const line = errorMessage(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' }));
  assert.match(line, /previous verified data was retained\. Cause: Error code=ECONNREFUSED$/);
  assert.doesNotMatch(line, /10\.0\.0\.5/);
  assert.equal(errorMessage(new Error('Job ownership was lost')), 'Job ownership was lost');
});
