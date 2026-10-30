/**
 * Cron outage matrix, shared-store cases (cron resilience, 2026-10-31): Upstash
 * down, slow, or holding a corrupted lastSuccessAt. Upstash must be configured
 * before the Jolpica request controller is created, so this file sets the
 * environment first and imports the routes dynamically. Deterministic: a small
 * in-memory Upstash REST emulator answers on a fixture host; no network.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.UPSTASH_REDIS_REST_URL = 'https://fixture-db.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fixture-token';
process.env.APEX_REDIS_SCOPE = 'cronfix';
process.env.CRON_SECRET = 'disposable-redis-secret';
delete process.env.VERCEL_ENV;
delete process.env.APEX_ENV;
delete process.env.DATABASE_URL;

type RunCron = (args: string[], env: Record<string, string>, options: Record<string, unknown>) => Promise<number>;
let runCronCommand: RunCron;
let weatherSync: (request: Request) => Promise<Response>;
let reset: () => void;
let forget: () => void;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const YEAR = new Date(NOW).getUTCFullYear();
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Test fixture: one race 40 days out (outside the forecast horizon, so no Open-Meteo read).
const calendar = { MRData: { xmlns: '', series: 'f1', url: 'https://api.jolpi.ca/ergast/f1/current.json', limit: '100', offset: '0', total: '1', RaceTable: { season: String(YEAR), Races: [{ season: String(YEAR), round: '1', raceName: 'Fixture Grand Prix', url: 'https://example.invalid/race', date: isoDay(NOW + 40 * DAY), time: '14:00:00Z', Circuit: { circuitId: 'fixture', circuitName: 'Fixture Circuit', url: 'https://example.invalid/circuit', Location: { lat: '19.4', long: '-99.09', locality: 'Fixture', country: 'Fixture' } } }] } } };

let redis: 'healthy' | 'down' | 'slow' | 'quota' | 'auth' | 'garbage' = 'healthy';
let jolpica: 'healthy' | 'down' = 'healthy';
const store = new Map<string, string>();
const keysWritten: string[] = [];
let commandCount = 0;
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'fixture-db.upstash.io') {
      commandCount += 1;
      if (redis === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
      if (redis === 'quota') return new Response(JSON.stringify({ error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500002' }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (redis === 'auth') return Response.json({ error: 'WRONGPASS' }, { status: 401 });
      if (redis === 'garbage') return new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      if (redis === 'slow') await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 3_000); init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true }); });
      const command = JSON.parse(String(init?.body)) as string[];
      const [name] = command;
      if (name === 'EVAL') {
        const script = command[1]!;
        // Reserve admits; complete/backoff acknowledge (shared-admission.ts scripts).
        return Response.json({ result: script.includes("redis.call('TIME')") ? [1, 0, 35_000] : 1 });
      }
      if (name === 'GET') return Response.json({ result: store.get(command[1]!) ?? null });
      if (name === 'SET') { store.set(command[1]!, command[2]!); keysWritten.push(command[1]!); return Response.json({ result: 'OK' }); }
      return Response.json({ error: 'ERR unknown command' }, { status: 400 });
    }
    if (url.hostname === 'api.jolpi.ca') {
      if (jolpica === 'down') return new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
      return Response.json(calendar);
    }
    throw new Error(`unexpected host ${url.hostname}`);
  }) as typeof fetch;
  ({ runCronCommand } = (await import('../../../scripts/invoke-cron.mjs' as string)) as { runCronCommand: RunCron });
  ({ GET: weatherSync } = await import('../app/api/cron/weather-sync/route'));
  const control = (await import('../../../packages/api-client/src/jolpica/request-control')).jolpicaRequestControl;
  reset = () => control.reset();
  forget = (await import('../lib/cron-outcome')).forgetCronSuccessesInProcess;
});
after(() => { globalThis.fetch = originalFetch; });
beforeEach(() => { reset(); forget(); store.clear(); keysWritten.length = 0; commandCount = 0; redis = 'healthy'; jolpica = 'healthy'; });

const call = async () => {
  const response = await weatherSync(new Request('https://apex.test/api/cron/weather-sync', { headers: { authorization: 'Bearer disposable-redis-secret' } }));
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown>, text };
};
const invoke = async (result: { status: number; text: string }) => {
  const output: string[] = [];
  const code = await runCronCommand(['weather-sync'], { APEX_SITE_URL: 'https://apex.test', CRON_SECRET: 'disposable-redis-secret' }, {
    fetchImpl: async () => new Response(result.text, { status: result.status, headers: { 'content-type': 'application/json' } }),
    log: (line: string) => output.push(line), errorLog: (line: string) => output.push(line), appendSummary: () => {}, sleep: async () => {},
  });
  return { code, text: output.join('\n') };
};
const lastSuccessKey = 'apex:local-cronfix:cron:v1:last-success:weather-sync';

test('healthy Upstash: a success is stored under the environment-scoped key, never a production key', async () => {
  const result = await call();
  assert.equal(result.status, 200, result.text);
  assert.ok(keysWritten.includes(lastSuccessKey), keysWritten.join(','));
  assert.ok(keysWritten.every((key) => key.startsWith('apex:local-cronfix:')), keysWritten.join(','));
  assert.match(store.get(lastSuccessKey)!, /^\d{13}$/);
});

test('a cold instance reads the shared lastSuccessAt: Jolpica down + recent shared success → 503, runner green with a warning', async () => {
  store.set(lastSuccessKey, String(Date.now() - 6 * HOUR));
  jolpica = 'down';
  const result = await call();
  assert.equal(result.status, 503, result.text);
  assert.equal(result.body.reason, 'provider-unavailable');
  assert.ok(Math.abs(Date.parse(String(result.body.lastSuccessAt)) - (Date.now() - 6 * HOUR)) < 60_000);
  const run = await invoke(result);
  assert.equal(run.code, 0); assert.match(run.text, /::warning::/);
});

test('corrupted shared lastSuccessAt reads as unknown: outage → runner red', async () => {
  for (const corrupted of ['yesterday', '-1', '1e13', '{"at":1}']) {
    reset(); forget();
    store.set(lastSuccessKey, corrupted);
    jolpica = 'down';
    const result = await call();
    assert.equal(result.status, 503);
    assert.equal(result.body.lastSuccessAt, null, corrupted);
    assert.equal((await invoke(result)).code, 1);
  }
});

// Redis is optional (incident 2026-10-31): Upstash failing (the exact quota 400 that
// broke production, auth, refused, slow, garbage) no longer blocks Jolpica reads.
for (const failure of ['quota', 'auth', 'down', 'slow', 'garbage'] as const) {
  test(`Upstash ${failure}: the cron still reads Jolpica (process-local admission) and answers 200; lastSuccessAt stays in process memory`, async () => {
    redis = failure;
    const result = await call();
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.ok, true);
    assert.equal((await invoke(result)).code, 0);
    assert.doesNotMatch(result.text, /jolpica-admission/);
  });

  test(`Upstash ${failure} + Jolpica down: 503 provider jolpica (never jolpica-admission); unknown lastSuccessAt is red, a success in this process is green`, async () => {
    redis = failure; jolpica = 'down';
    const cold = await call();
    assert.equal(cold.status, 503, cold.text);
    assert.equal(cold.body.reason, 'provider-unavailable');
    assert.equal(cold.body.provider, 'jolpica');
    assert.equal(cold.body.lastSuccessAt, null, 'the shared store cannot be read');
    assert.equal((await invoke(cold)).code, 1);
    reset(); jolpica = 'healthy';
    assert.equal((await call()).status, 200);
    reset(); jolpica = 'down'; redis = failure;
    const warm = await call();
    assert.equal(warm.status, 503);
    assert.notEqual(warm.body.lastSuccessAt, null);
    const run = await invoke(warm);
    assert.equal(run.code, 0); assert.match(run.text, /::warning::.*jolpica/);
  });
}

/**
 * Command budget (DEPLOY.md "Redis usage budget"): one healthy weather-sync
 * run spends at most 4 Redis commands (admission reserve + complete, one
 * last-good copy, the lastSuccessAt write); a second run in the same hour
 * reuses the process copy of the calendar and only records its success.
 */
test('command budget: a weather-sync run costs ≤ 4 Redis commands, a repeat run ≤ 2', async () => {
  assert.equal((await call()).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(commandCount <= 4, `${commandCount} commands`);
  commandCount = 0;
  assert.equal((await call()).status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(commandCount <= 2, `${commandCount} commands on the repeat run`);
});
