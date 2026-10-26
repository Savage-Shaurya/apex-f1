import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { runLeasedCron } from './leased-cron';
import type { LeaseStore } from '../../workers/src/lib/job-control';
import { ProviderError } from '../../../packages/api-client/src/transport';

const original = process.env.CRON_SECRET;
afterEach(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; });
const request = (authorized = true) => new Request('http://localhost/api/cron/fixture', { headers: authorized ? { authorization: 'Bearer disposable-test-secret' } : {} });
function store(overrides: Partial<LeaseStore> = {}): LeaseStore {
  return {
    claim: async ({ key }) => ({ key, token: 'synthetic-lease', expiresAt: new Date(Date.now() + 120_000).toISOString() }),
    renew: async (lease) => lease, release: async () => true, ...overrides,
  };
}

test('cron authentication precedes storage and duplicate-work ownership', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const response = await runLeasedCron(request(false), 'fixture', async () => assert.fail('unauthorized task'), store({ claim: async () => assert.fail('unauthorized storage access') }));
  assert.equal(response.status, 401);
});

test('cron duplicate invocation reports a healthy explicit skip and performs no provider work', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const response = await runLeasedCron(request(), 'fixture', async () => assert.fail('duplicate task'), store({ claim: async () => null }));
  assert.equal(response.status, 200);
  const report = await response.json(); assert.equal(report.ok, true); assert.match(report.skipped, /Another owner/);
});

test('a job store outage fails closed before providers and does not expose configuration', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const response = await runLeasedCron(request(), 'fixture', async () => assert.fail('unowned task'), store({ claim: async () => { throw new Error('postgres://private:password@host/database'); } }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private|password|host\/database/);
});

test('a failed lease release keeps the finished task report and flags the cleanup failure', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const response = await runLeasedCron(request(), 'fixture', async () => Response.json({ ok: true, sent: 'broadcast-1' }), store({ release: async () => false }));
  // The work already happened: reporting 503 "rerun" here would invite a duplicate.
  assert.equal(response.status, 200); assert.equal((await response.json()).sent, 'broadcast-1');
  assert.match(response.headers.get('x-apex-cron-lease') ?? '', /release-failed/);
});

test('a task error is reported as the failure even when release also fails', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const response = await runLeasedCron(request(), 'fixture', async () => { throw new Error('provider down'); }, store({ release: async () => { throw new Error('release down'); } }));
  assert.equal(response.status, 503);
});

const originalDatabase = process.env.DATABASE_URL;
afterEach(() => { if (originalDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabase; });

test('optional-lease cache jobs run unleased without a database instead of failing every schedule', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  delete process.env.DATABASE_URL;
  let ran = 0;
  const response = await runLeasedCron(request(), 'fixture', async (job) => { ran++; job.assertActive(); assert.ok(job.remainingMs() > 0); return Response.json({ ok: true }); }, { lease: 'optional', store: store({ claim: async () => assert.fail('no database lease without DATABASE_URL') }) });
  assert.equal(response.status, 200); assert.equal(ran, 1);
  assert.match(response.headers.get('x-apex-cron-lease') ?? '', /none/);
});

test('optional-lease jobs still take the database lease when a database is configured', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  process.env.DATABASE_URL = 'postgres://offline-fixture.invalid/apex';
  let claimed = 0;
  const response = await runLeasedCron(request(), 'fixture', async () => Response.json({ ok: true }), { lease: 'optional', store: store({ claim: async ({ key }) => { claimed++; return { key, token: 'synthetic-lease', expiresAt: new Date(Date.now() + 120_000).toISOString() }; } }), recorder: null });
  assert.equal(response.status, 200); assert.equal(claimed, 1);
});

test('required-lease jobs record one durable run inside the lease and close it with the outcome', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const events: string[] = [];
  const recorder = {
    open: async (route: string, lease: { token: string }) => { events.push(`open:${route}:${lease.token}`); return 'run-1'; },
    close: async (runId: string, outcome: { ok: boolean; error?: string }) => { events.push(`close:${runId}:${outcome.ok}:${outcome.error ?? ''}`); },
  };
  await runLeasedCron(request(), 'fixture', async () => Response.json({ ok: false, error: 'upstream 503' }, { status: 500 }), { store: store(), recorder });
  assert.deepEqual(events, ['open:fixture:synthetic-lease', 'close:run-1:false:upstream 503']);
});

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9 postgres://private:password@host/database'), { code: 'ECONNREFUSED' });
async function captureErrors<T>(run: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const originalError = console.error, originalInfo = console.info;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try { return { value: await run(), logged: lines.join('\n') }; } finally { console.error = originalError; console.info = originalInfo; }
}

test('R3-BE-2: a lease store outage reports and logs the redacted error class instead of a generic line', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const { value: response, logged } = await captureErrors(() => runLeasedCron(request(), 'fixture', async () => assert.fail('unowned task'), store({ claim: async () => { throw refused(); } })));
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /code=ECONNREFUSED/);
  assert.match(logged, /code=ECONNREFUSED/);
  assert.doesNotMatch(body + logged, /private|password|host\/database|127\.0\.0\.1/);
});

test('R3-BE-2: a throwing task closes its ingestion run with the error class and logs it', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const closed: string[] = [];
  const recorder = { open: async () => 'run-9', close: async (_id: string, outcome: { ok: boolean; error?: string }) => { closed.push(outcome.error ?? ''); } };
  const { value: response, logged } = await captureErrors(() => runLeasedCron(request(), 'fixture', async () => { throw new ProviderError('jolpica', 'http', 503); }, { store: store(), recorder }));
  assert.equal(response.status, 503);
  assert.equal(closed.length, 1);
  assert.match(closed[0]!, /ProviderError provider=jolpica code=http status=503/);
  assert.match(await response.text(), /ProviderError provider=jolpica/);
  assert.match(logged, /ProviderError provider=jolpica/);
});

test('R3-BE-3: optional-lease cache jobs still run when the database is configured but unreachable', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  process.env.DATABASE_URL = 'postgres://offline-fixture.invalid/apex';
  let ran = 0, unleased: boolean | undefined;
  const { value: response } = await captureErrors(() => runLeasedCron(request(), 'fixture', async (job) => { ran++; unleased = job.unleased; job.assertActive(); return Response.json({ ok: true }); }, { lease: 'optional', store: store({ claim: async () => { throw refused(); } }), recorder: null }));
  assert.equal(response.status, 200); assert.equal(ran, 1); assert.equal(unleased, true);
  assert.match(response.headers.get('x-apex-cron-lease') ?? '', /unavailable/);
});

test('R3-BE-3: an optional-lease job whose run record cannot be opened still runs', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  process.env.DATABASE_URL = 'postgres://offline-fixture.invalid/apex';
  let ran = 0;
  const recorder = { open: async () => { throw refused(); }, close: async () => assert.fail('no run was opened') };
  const { value: response } = await captureErrors(() => runLeasedCron(request(), 'fixture', async () => { ran++; return Response.json({ ok: true }); }, { lease: 'optional', store: store(), recorder }));
  assert.equal(response.status, 200); assert.equal(ran, 1);
});

test('R3-BE-3: required-lease jobs stay strict when the lease store is unreachable', async () => {
  process.env.CRON_SECRET = 'disposable-test-secret';
  const { value: response } = await captureErrors(() => runLeasedCron(request(), 'fixture', async () => assert.fail('no unleased fallback for strict jobs'), { store: store({ claim: async () => { throw refused(); } }), recorder: null }));
  assert.equal(response.status, 503);
});
