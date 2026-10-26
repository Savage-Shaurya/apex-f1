import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, readFile, unlink, rmdir, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { hashAdminPassword } from '../lib/admin-auth';
import { adminSessionConfiguration } from '../lib/admin-session';

const hash = await hashAdminPassword('synthetic-mfa-provisioning-password-20261004');
const profiles = [{ username: 'owner', passwordHash: hash, capabilities: ['read', 'write', 'publish'] }, { username: 'reader', passwordHash: hash, capabilities: ['read'] }];
async function secureDirectory(directory: string) {
  if (process.platform !== 'win32') return;
  const run = promisify(execFile);
  const identity = (await run('whoami.exe', [], { windowsHide: true })).stdout.trim();
  await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)(F)`, '*S-1-5-18:(OI)(CI)(F)'], { windowsHide: true });
}
async function cli(output: string, input: string, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve('scripts/admin-mfa-provision.mjs'), output, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value.toString(); }); child.stderr.on('data', value => { stderr += value.toString(); });
    child.on('error', reject); child.on('exit', code => resolvePromise({ code, stdout, stderr }));
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
test('private provisioning creates unique factors, valid session config and restricted file without stdout secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apex-mfa-private-test-'));
  await secureDirectory(directory);
  const output = join(directory, 'admins.private.json');
  try {
    const result = await cli(output, JSON.stringify(profiles)); assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const material = JSON.parse(await readFile(output, 'utf8'));
    const factors = JSON.parse(material.ADMIN_MFA_SECRETS_JSON);
    assert.equal(new Set(Object.values(factors)).size, 2);
    assert.equal(Object.values(factors).every(value => typeof value === 'string' && /^[A-Z2-7]{32}$/.test(value)), true);
    assert.equal(/^[A-Za-z0-9_-]{43}$/.test(material.ADMIN_SESSION_SECRET), true);
    for (const value of [hash, material.ADMIN_SESSION_SECRET, ...Object.values(factors)]) assert.equal(result.stdout.includes(String(value)), false, 'CLI does not print private provisioning material');
    assert.equal(adminSessionConfiguration({ ...material, UPSTASH_REDIS_REST_URL: 'https://provision-fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic-test-token' }).actors.length, 2);
    if (process.platform === 'win32') {
      const acl = (await promisify(execFile)('icacls.exe', [output], { windowsHide: true })).stdout;
      assert.equal(acl.includes('(I)'), false, 'Inherited ACL grants removed before writing');
      assert.equal(/Everyone|BUILTIN\\Users|Authenticated Users/i.test(acl), false, 'No broad reader group grant');
    } else assert.equal((await stat(output)).mode & 0o777, 0o600);
    const before = await readFile(output); const second = await cli(output, JSON.stringify(profiles));
    assert.equal(second.code, 1); assert.equal(second.stdout, ''); assert.equal((await readFile(output)).equals(before), true, 'Existing material cannot be overwritten');
  } finally { await unlink(output).catch(() => {}); await rmdir(directory); }
});
test('provisioning rejects unsupported profiles, secret-shaped argv, oversized input and unsafe paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apex-mfa-rejection-test-'));
  await secureDirectory(directory);
  const output = join(directory, 'rejected.private.json');
  try {
    for (const input of ['not JSON', '{}', '[]', JSON.stringify([{ ...profiles[0], capabilities: ['superuser'] }]), JSON.stringify([profiles[0], profiles[0]]), 'x'.repeat(65_537)]) {
      const result = await cli(output, input); assert.equal(result.code, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes(input), false);
      await assert.rejects(access(output));
    }
    const unsafe = resolve(`unsafe-${randomUUID()}.private.json`);
    assert.equal((await cli(unsafe, JSON.stringify(profiles))).code, 1); await assert.rejects(access(unsafe));
    assert.equal((await cli('relative.private.json', JSON.stringify(profiles))).code, 1);
    assert.equal((await cli(output, JSON.stringify(profiles), ['do-not-place-secrets-in-argv'])).code, 1);
  } finally { await unlink(output).catch(() => {}); await rmdir(directory); }
});
test('Windows provisioning refuses an inherited output folder before any file can be opened', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apex-mfa-inherited-test-'));
  const output = join(directory, 'admins.private.json');
  try {
    const result = await cli(output, JSON.stringify(profiles)); assert.equal(result.code, 1); assert.equal(result.stdout, '');
    await assert.rejects(access(output));
  } finally { await rmdir(directory); }
});
