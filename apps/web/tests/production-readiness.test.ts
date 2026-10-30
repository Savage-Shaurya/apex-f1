import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Production-readiness behaviour (2026-10-26 launch pass): structured,
 * redacted failure logs; a cheap rate-limited health endpoint; fail-fast
 * production configuration; a designed root error state; the Seoul region and
 * a news cadence that fits a private repository's free Actions minutes.
 */
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(web, '../..');

function captureConsole<T>(fn: () => T): { out: T; lines: { level: string; text: string }[] } {
  const lines: { level: string; text: string }[] = [];
  const original = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const level of ['info', 'warn', 'error', 'log'] as const) console[level] = (...args: unknown[]) => { lines.push({ level, text: args.map(String).join(' ') }); };
  try { return { out: fn(), lines }; } finally { Object.assign(console, original); }
}

test('structured logger emits one JSON line per event at the right level and redacts secrets', async () => {
  const { logEvent, redact } = await import('../lib/log');
  const { lines } = captureConsole(() => logEvent('error', 'provider.failed', {
    provider: 'newsapi',
    error: 'GET https://newsapi.org/v2/everything?q=f1&apiKey=abcdef1234567890 failed',
    authorization: 'Bearer super-secret-token-value',
    url: 'postgres://apex_runtime:hunter2-password@db.example/apex',
  }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.level, 'error');
  const record = JSON.parse(lines[0]!.text) as Record<string, unknown>;
  assert.equal(record.level, 'error');
  assert.equal(record.event, 'provider.failed');
  assert.equal(record.provider, 'newsapi');
  assert.match(String(record.ts), /^\d{4}-\d{2}-\d{2}T/);
  for (const secret of ['abcdef1234567890', 'super-secret-token-value', 'hunter2-password']) assert.equal(lines[0]!.text.includes(secret), false, secret);
  assert.equal(redact('token=abc123456789&x=1').includes('abc123456789'), false);
  assert.equal(redact('https://apex.example/callback?code=oauth-code-123&state=1').includes('oauth-code-123'), false, 'OAuth codes in URLs are redacted');
  assert.match(redact('Error code=ECONNREFUSED'), /code=ECONNREFUSED/, 'error codes stay readable (R3-BE-2)');
});

test('a failed cron report is logged at error level, a healthy one at info', async () => {
  const { logReport, buildReport } = await import('../lib/cron-auth');
  const failed = captureConsole(() => logReport(buildReport(Date.now(), { ok: false, route: 'rss-sync', error: 'upstream down' })));
  assert.equal(failed.lines.length, 1);
  assert.equal(failed.lines[0]!.level, 'error');
  const parsed = JSON.parse(failed.lines[0]!.text) as Record<string, unknown>;
  assert.equal(parsed.event, 'cron.report');
  assert.equal(parsed.route, 'rss-sync');
  assert.equal(parsed.ok, false);
  const healthy = captureConsole(() => logReport(buildReport(Date.now(), { ok: true, route: 'rss-sync' })));
  assert.equal(healthy.lines[0]!.level, 'info');
});

test('health report: 200 when every check passes, 503 when the database is down, never leaks configuration', async () => {
  const { runHealthChecks } = await import('../lib/health');
  const secretEnv = { DATABASE_URL: 'postgres://apex_runtime:pw-should-not-leak@db.example/apex', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'tok-should-not-leak' };
  const ok = await runHealthChecks({
    env: secretEnv,
    database: async () => undefined,
    redis: async () => undefined,
    provider: async () => undefined,
  });
  assert.equal(ok.httpStatus, 200);
  assert.equal(ok.body.status, 'ok');
  assert.equal(ok.body.checks.database.status, 'ok');
  assert.equal(ok.body.checks.redis.status, 'ok');
  assert.ok(Object.keys(ok.body.checks.providers).length >= 3);

  const down = await runHealthChecks({
    env: secretEnv,
    database: async () => { throw new Error('connect ECONNREFUSED postgres://apex_runtime:pw-should-not-leak@db.example'); },
    redis: async () => undefined,
    provider: async (name) => { if (name === 'openf1') throw new Error('timeout'); },
  });
  assert.equal(down.httpStatus, 503);
  assert.equal(down.body.status, 'down');
  assert.equal(down.body.checks.database.status, 'down');
  assert.equal(down.body.checks.providers.openf1!.status, 'down');
  const text = JSON.stringify(down.body) + JSON.stringify(ok.body);
  for (const secret of ['pw-should-not-leak', 'tok-should-not-leak', 'ECONNREFUSED']) assert.equal(text.includes(secret), false, secret);

  const degraded = await runHealthChecks({ env: secretEnv, database: async () => undefined, redis: async () => undefined, provider: async (name) => { if (name === 'jolpica') throw new Error('x'); } });
  assert.equal(degraded.httpStatus, 200);
  assert.equal(degraded.body.status, 'degraded');

  const unconfigured = await runHealthChecks({ env: {}, database: async () => undefined, redis: async () => undefined, provider: async () => undefined });
  assert.equal(unconfigured.body.checks.database.status, 'not-configured');
  assert.equal(unconfigured.body.checks.redis.status, 'not-configured');
});

test('health route exists, is dynamic, rate-limited and never cached', () => {
  const file = path.join(web, 'app/api/health/route.ts');
  assert.ok(existsSync(file), 'app/api/health/route.ts');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /export async function GET/);
  // Per-instance brake: a health check never spends a Redis command (2026-10-31).
  assert.match(source, /rateLimit\(/);
  assert.doesNotMatch(source, /rateLimitShared\(/);
  assert.match(source, /no-store/);
  assert.match(source, /dynamic = 'force-dynamic'/);
});

test('production startup check fails fast with field names (never values) and stays off outside production', async () => {
  const { assertProductionEnvironment, strictEnvironment } = await import('../lib/startup-env');
  assert.equal(strictEnvironment({ VERCEL_ENV: 'production' }), true);
  assert.equal(strictEnvironment({ VERCEL_ENV: 'preview' }), false);
  assert.equal(strictEnvironment({ NODE_ENV: 'production' }), false, 'a local next start without the flag is not forced');
  assert.equal(strictEnvironment({ APEX_STRICT_ENV: 'true' }), true);
  // Not strict: no throw even with nothing configured.
  assert.doesNotThrow(() => assertProductionEnvironment({ NODE_ENV: 'production' }));
  // Strict and broken: throws listing fields, including the development bypass.
  const bad = { VERCEL_ENV: 'production', ADMIN_LOCAL_DEV_BYPASS: 'true', CRON_SECRET: 'short-secret-value' };
  assert.throws(() => assertProductionEnvironment(bad), (error: Error) => {
    assert.match(error.message, /ADMIN_LOCAL_DEV_BYPASS/);
    assert.match(error.message, /CRON_SECRET/);
    assert.match(error.message, /UPSTASH_REDIS_REST_URL/);
    assert.equal(error.message.includes('short-secret-value'), false);
    return true;
  });
  // A NEXT_PUBLIC_ variable that looks like a secret is refused.
  const { publicSecretFields } = await import('../lib/startup-env');
  assert.deepEqual(publicSecretFields({ NEXT_PUBLIC_SITE_URL: 'https://a', NEXT_PUBLIC_POSTHOG_KEY: 'phc_public', NEXT_PUBLIC_RESEND_API_KEY: 'x', NEXT_PUBLIC_DB_PASSWORD: 'y' }).sort(), ['NEXT_PUBLIC_DB_PASSWORD', 'NEXT_PUBLIC_RESEND_API_KEY']);
});

test('instrumentation registers the startup check on the Node runtime', () => {
  const file = path.join(web, 'instrumentation.ts');
  assert.ok(existsSync(file), 'instrumentation.ts');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /export async function register/);
  assert.match(source, /NEXT_RUNTIME === 'nodejs'/);
  assert.match(source, /assertProductionEnvironment/);
});

test('a designed root-level global error exists, owns <html>/<body> and never prints the raw error', () => {
  const file = path.join(web, 'app/global-error.tsx');
  assert.ok(existsSync(file), 'app/global-error.tsx');
  const source = readFileSync(file, 'utf8');
  assert.match(source, /^'use client';/);
  assert.match(source, /<html[\s>]/);
  assert.match(source, /<body[\s>]/);
  assert.match(source, /Try again/);
  assert.equal(/error\.(message|stack)/.test(source), false, 'no raw error text to visitors');
});

test('hosting runs in Seoul (icn1) and Vercel crons stay within the Hobby once-a-day limit', () => {
  const vercel = JSON.parse(readFileSync(path.join(web, 'vercel.json'), 'utf8')) as { regions?: string[]; crons: { schedule: string }[] };
  assert.deepEqual(vercel.regions, ['icn1']);
  for (const cron of vercel.crons) {
    const [minute, hour] = cron.schedule.split(' ');
    assert.match(minute!, /^\d+$/, cron.schedule);
    assert.match(hour!, /^\d+$/, cron.schedule);
  }
});

test('news refresh runs at most every 30 minutes (fits private-repo free minutes)', () => {
  const workflow = readFileSync(path.join(root, '.github/workflows/refresh-news.yml'), 'utf8');
  const schedules = [...workflow.matchAll(/cron: "([^"]+)"/g)].map(m => m[1]!);
  assert.equal(schedules.length, 1);
  const minute = schedules[0]!.split(' ')[0]!;
  const perHour = minute.includes('/') ? 60 / Number(minute.split('/')[1]) : minute.split(',').length;
  assert.ok(perHour <= 2, `news runs ${perHour} times an hour`);
});

test('the canonical origin comes only from NEXT_PUBLIC_SITE_URL; production refuses a missing or loopback value', async () => {
  const { siteOrigin, assertSiteOrigin } = await import('../components/shell/site-metadata');
  const prod = { VERCEL_ENV: 'production' };
  for (const value of [undefined, '', 'http://localhost:3000', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'http://apex.example', 'https://user:pw@apex.example', 'not a url']) {
    assert.throws(() => assertSiteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: value }), /NEXT_PUBLIC_SITE_URL/, `assert ${String(value)}`);
    assert.throws(() => siteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: value }), /NEXT_PUBLIC_SITE_URL/, `siteOrigin ${String(value)}`);
  }
  // A local production rehearsal is held to the same rule.
  assert.throws(() => siteOrigin({ APEX_STRICT_ENV: 'true' }), /NEXT_PUBLIC_SITE_URL/);
  assert.doesNotThrow(() => assertSiteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://apex.example' }));
  assert.equal(siteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://apex.example/some/path' }), 'https://apex.example');
  // No hard-coded production host and no second source: without the variable, development uses its own local origin.
  assert.equal(siteOrigin({}), 'http://localhost:3000');
  assert.equal(siteOrigin({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: 'apex-f1-five.vercel.app' }), 'http://localhost:3000');
});

test('next.config refuses a production build or start without a real NEXT_PUBLIC_SITE_URL', async () => {
  const { spawnSync } = await import('node:child_process');
  const { createRequire } = await import('node:module');
  const tsx = createRequire(path.join(root, 'apps/workers/package.json')).resolve('tsx/cli');
  const load = (extra: Record<string, string>) => {
    // A clean environment: only what node needs plus the case under test (the test runner's own loader variables stay out).
    const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...extra };
    return spawnSync(process.execPath, [tsx, '--eval', "import('./next.config.ts').then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); })"], { cwd: web, env: env as NodeJS.ProcessEnv, encoding: 'utf8' });
  };
  for (const value of ['http://localhost:3000', '']) {
    const run = load({ VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: value });
    assert.notEqual(run.status, 0, `refused ${value || '(missing)'}`);
    assert.match(run.stderr, /NEXT_PUBLIC_SITE_URL/);
  }
  assert.equal(load({ VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://apex.example' }).status, 0);
  assert.equal(load({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }).status, 0, 'local development and local builds are not forced');
});

test('no source file hard-codes the production origin (it changes with the hosting account)', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', '.turbo'].includes(name) || name.startsWith('.next-')) continue;
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\./.test(name) && readFileSync(file, 'utf8').includes('apex-f1-five.vercel.app')) offenders.push(path.relative(root, file));
    }
  };
  for (const dir of ['apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/workers/src', 'packages', 'scripts']) walk(path.join(root, dir));
  walk(path.join(root, 'apps/web')); // next.config.ts, instrumentation.ts, proxy.ts
  assert.deepEqual([...new Set(offenders)], []);
});

test('an unknown /api path answers JSON 404, not the HTML page', async () => {
  const file = path.join(web, 'app/api/[...slug]/route.ts');
  assert.ok(existsSync(file), 'app/api/[...slug]/route.ts');
  const route = await import('../app/api/[...slug]/route');
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    const response = await route[method]();
    assert.equal(response.status, 404, method);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { ok: false, error: 'not found' });
  }
});
