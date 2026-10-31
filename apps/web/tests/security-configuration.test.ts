import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { hashAdminPassword } from '../lib/admin-auth';
import { inspectProductionSecurityConfiguration } from '../lib/security-configuration';

const password = 'synthetic-config-owner-secret-32-bytes';
const hash = await hashAdminPassword(password);
const valid = {
  CRON_SECRET: 'synthetic-cron-secret-longer-than-32-bytes', PREDICTION_COOKIE_SECRET: 'synthetic-prediction-secret-longer-than-32-bytes',
  ADMIN_USERS_JSON: JSON.stringify([{ username: 'owner', passwordHash: hash, capabilities: ['read', 'write', 'publish', 'image'] }]),
  ADMIN_SESSION_SECRET: Buffer.alloc(32, 37).toString('base64url'), ADMIN_MFA_SECRETS_JSON: JSON.stringify({ owner: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }),
  UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic-quota-token',
  DATABASE_URL: 'postgres://apex_runtime:synthetic-database-secret@db.invalid/apex', DATABASE_WORKER_URL: 'postgres://apex_jobs:synthetic-worker-secret@db.invalid/apex', NEXT_PUBLIC_SITE_URL: 'https://apex.example',
  RESEND_API_KEY: 'synthetic-mail-secret', RESEND_AUDIENCE_ID: 'synthetic-audience', RESEND_FROM_EMAIL: 'news@apex.example',
};
test('release configuration is separate from verified service connectivity and never prints values', () => {
  const result = inspectProductionSecurityConfiguration(valid);
  assert.equal(result.ready, true);
  assert.equal(result.serviceConnectionsVerified, false);
  assert.equal(result.issues.some(issue => issue.code === 'basic-auth-lifecycle'), false);
  for (const value of [password, valid.DATABASE_URL, valid.RESEND_API_KEY, hash]) assert.equal(JSON.stringify(result).includes(value), false);
});
test('missing services and weak operator secrets are explicit release blockers', () => {
  const missing = inspectProductionSecurityConfiguration({});
  assert.equal(missing.ready, false);
  for (const field of ['CRON_SECRET', 'PREDICTION_COOKIE_SECRET', 'ADMIN_USERS_JSON', 'DATABASE_URL', 'RESEND_API_KEY', 'NEXT_PUBLIC_SITE_URL']) {
    assert.ok(missing.issues.some(issue => issue.field === field && issue.severity === 'error'), field);
  }
  const weak = inspectProductionSecurityConfiguration({ ...valid, CRON_SECRET: 'short', ADMIN_PASSWORD: 'short-owner' });
  assert.equal(weak.ready, false);
  assert.ok(weak.issues.some(issue => issue.field === 'ADMIN_PASSWORD' && issue.code === 'invalid-secret'));
});
test('runtime owner roles, disabled TLS, local bypass and missing publisher fail production preflight', () => {
  const result = inspectProductionSecurityConfiguration({ ...valid,
    DATABASE_URL: 'postgres://postgres:synthetic-secret@db.invalid/apex?sslmode=disable',
    ADMIN_USERS_JSON: JSON.stringify([{ username: 'reader', passwordHash: hash, capabilities: ['read'] }]),
    ADMIN_LOCAL_DEV_BYPASS: 'true',
  });
  assert.equal(result.ready, false);
  for (const code of ['owner-role', 'insecure-tls', 'missing-publisher', 'development-bypass']) assert.ok(result.issues.some(issue => issue.code === code), code);
});
// Redis is optional (review R-01): production starts without Upstash, with a warning.
test('production configuration without Upstash is ready, with a shared-store warning, and startup does not refuse', async () => {
  const withoutRedis: Record<string, string> = { ...valid };
  delete withoutRedis.UPSTASH_REDIS_REST_URL;
  delete withoutRedis.UPSTASH_REDIS_REST_TOKEN;
  const result = inspectProductionSecurityConfiguration(withoutRedis);
  assert.equal(result.ready, true);
  assert.ok(result.issues.some(issue => issue.field === 'UPSTASH_REDIS_REST_URL' && issue.code === 'shared-store-missing' && issue.severity === 'warning'));
  assert.equal(result.issues.some(issue => /UPSTASH|DISTRIBUTED/.test(issue.field) && issue.severity === 'error'), false);
  const malformed = inspectProductionSecurityConfiguration({ ...valid, UPSTASH_REDIS_REST_URL: 'http://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'two words' });
  assert.equal(malformed.ready, true);
  assert.ok(malformed.issues.some(issue => issue.code === 'invalid-store-origin' && issue.severity === 'warning'));
  const { assertProductionEnvironment } = await import('../lib/startup-env');
  const lines: string[] = [];
  const info = console.info, warn = console.warn, error = console.error;
  console.info = console.warn = console.error = (line: unknown) => { lines.push(String(line)); };
  try { assert.doesNotThrow(() => assertProductionEnvironment({ ...withoutRedis, VERCEL_ENV: 'production' })); }
  finally { console.info = info; console.warn = warn; console.error = error; }
  assert.ok(lines.some(line => line.includes('startup.config-warning') && line.includes('UPSTASH_REDIS_REST_URL (shared-store-missing)')), lines.join('\n'));
});
test('unapproved credential origins and malformed inference flags are rejected without contacting services', () => {
  const result = inspectProductionSecurityConfiguration({ ...valid, UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io.attacker.invalid', NEXT_PUBLIC_SITE_URL: 'http://apex.example', RESEND_FROM_EMAIL: 'onboarding@resend.dev', HUGGINGFACE_INFERENCE_ENABLED: 'tru', GROQ_INFERENCE_ENABLED: 'true' });
  assert.equal(result.ready, false);
  for (const code of ['invalid-store-origin', 'invalid-public-origin', 'invalid-newsletter-sender', 'invalid-inference-flag', 'missing-inference-token']) assert.ok(result.issues.some(issue => issue.code === code), code);
});
test('the worker role must be independently configured with verified TLS and public origin must be public', () => {
  for (const worker of ['', valid.DATABASE_URL, 'postgres://postgres:owner-secret@db.invalid/apex?sslmode=disable']) {
    const result = inspectProductionSecurityConfiguration({ ...valid, DATABASE_WORKER_URL: worker });
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(issue => issue.field === 'DATABASE_WORKER_URL' && issue.severity === 'error'));
  }
  for (const origin of ['https://localhost:8443', 'https://127.0.0.1', 'https://[::1]', 'https://service.internal', 'https://apex.example;script-src']) {
    assert.ok(inspectProductionSecurityConfiguration({ ...valid, NEXT_PUBLIC_SITE_URL: origin }).issues.some(issue => issue.field === 'NEXT_PUBLIC_SITE_URL'));
  }
});
async function cli(input: string, args: string[] = []) {
  return new Promise<{ code: number | null; output: string; error: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve('scripts/admin-password-hash.mjs'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { error += data.toString(); });
    child.on('error', reject); child.on('exit', code => resolve({ code, output, error }));
    child.stdin.end(input);
  });
}
test('administrator hash provisioning reads stdin and returns only a salted hash', async () => {
  const result = await cli(password + '\n');
  assert.equal(result.code, 0); assert.match(result.output, /^scrypt\$[a-zA-Z0-9_-]{22}\$[a-zA-Z0-9_-]{43}\n$/);
  assert.equal(result.output.includes(password), false); assert.equal(result.error, '');
});
test('administrator hash provisioning rejects argv, weak and oversized input without echoing it', async () => {
  for (const [input, args] of [['short', []], ['a'.repeat(515), []], [password, ['unsupported-argument']]] as [string, string[]][]) {
    const result = await cli(input, args);
    assert.equal(result.code, 1); assert.equal(result.output, ''); assert.equal(result.error.includes(input), false);
  }
});
