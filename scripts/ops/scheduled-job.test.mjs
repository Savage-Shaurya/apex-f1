// Outage policy for the non-route scheduled jobs (db-backup, dependency-security): cron resilience, 2026-10-31.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EX_TEMPFAIL, SUCCESS_MARKER_STEP, isNpmOutage, lastVerifiedSuccess, runScheduledJob } from './scheduled-job.mjs';
import { BackupError, isDatabaseOutageText, isStorageOutageStatus, runBackup } from './backup-db.mjs';
import { runDependencyAudit } from '../dependency-audit.mjs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-31T12:00:00Z');
const githubEnv = { GITHUB_REPOSITORY: 'owner/apex-f1', GITHUB_TOKEN: 'synthetic-token', GITHUB_WORKFLOW_REF: 'owner/apex-f1/.github/workflows/db-backup.yml@refs/heads/main' };
/** Fake GitHub REST API: one earlier run whose marker step finished `hoursAgo` ago (or none). */
function github(hoursAgo, { markerConclusion = 'success', status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    if (status !== 200) return new Response('{}', { status });
    if (new URL(url).pathname === '/repos/owner/apex-f1') return Response.json({ default_branch: 'main' });
    if (/\/actions\/workflows\/db-backup\.yml\/runs\?status=success/.test(url)) {
      const event = new URL(url).searchParams.get('event');
      return Response.json({ workflow_runs: hoursAgo === null || event !== 'schedule' ? [] : [{ id: 41, event: 'schedule', head_branch: 'main', head_repository: { full_name: 'owner/apex-f1' }, path: '.github/workflows/db-backup.yml' }] });
    }
    if (/\/actions\/runs\/41\/jobs/.test(url)) return Response.json({ jobs: [{ steps: [{ name: 'Back up database to private Supabase Storage', conclusion: 'success', completed_at: new Date(NOW - hoursAgo * HOUR).toISOString() }, { name: SUCCESS_MARKER_STEP, conclusion: markerConclusion, completed_at: new Date(NOW - hoursAgo * HOUR).toISOString() }] }] });
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}
function harness(results, gh = github(5)) {
  const output = [], summary = [], outputs = [], sleeps = [];
  let runs = 0;
  return {
    output, summary, outputs, sleeps, runs: () => runs,
    options: {
      run: async () => results[Math.min(runs++, results.length - 1)],
      fetchImpl: gh.fetchImpl, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); },
      log: (line) => output.push(line), errorLog: (line) => output.push(line),
      appendSummary: (line) => summary.push(line), setOutput: (name, value) => outputs.push(`${name}=${value}`),
    },
  };
}
const args = ['--job', 'db-backup', '--stale-after-hours=48', '--', 'node', 'scripts/ops/backup-db.mjs'];

test('success: exit 0 and outcome=ok (the marker step then records a verified success)', async () => {
  const run = harness([{ code: 0, output: '' }]);
  assert.equal(await runScheduledJob(args, githubEnv, run.options), 0);
  assert.deepEqual(run.outputs, ['outcome=ok']);
  assert.equal(run.runs(), 1);
});

test('Supabase outage (exit 75): retried twice, then green + warning + outcome=deferred while the last verified backup is recent', async () => {
  const run = harness([{ code: EX_TEMPFAIL, output: '' }]);
  assert.equal(await runScheduledJob(args, githubEnv, run.options), 0);
  assert.equal(run.runs(), 3); assert.deepEqual(run.sleeps, [30_000, 90_000]);
  assert.deepEqual(run.outputs, ['outcome=deferred']);
  assert.match(run.output.join('\n'), /::warning::db-backup: upstream unavailable/);
  assert.match(run.summary.join('\n'), /⚠️/);
});

test('outage clearing on a retry is a plain success', async () => {
  const run = harness([{ code: EX_TEMPFAIL, output: '' }, { code: 0, output: '' }]);
  assert.equal(await runScheduledJob(args, githubEnv, run.options), 0);
  assert.equal(run.runs(), 2); assert.deepEqual(run.outputs, ['outcome=ok']);
});

test('outage with a stale, missing or unknowable last verified success fails red', async () => {
  for (const [gh, label] of [[github(49), 'stale'], [github(null), 'none'], [github(5, { markerConclusion: 'skipped' }), 'deferred runs never count'], [github(5, { status: 503 }), 'GitHub API down'], [github(5), 'no token']]) {
    const env = label === 'no token' ? { ...githubEnv, GITHUB_TOKEN: '' } : githubEnv;
    const run = harness([{ code: EX_TEMPFAIL, output: '' }], gh);
    assert.equal(await runScheduledJob(args, env, run.options), 1, label);
    assert.match(run.output.join('\n'), /::error::db-backup: upstream unavailable/, label);
    assert.deepEqual(run.outputs, [], label);
  }
  // 47 h 59 min is still inside the 48 h limit; 48 h 01 min is not.
  assert.equal(await runScheduledJob(args, githubEnv, harness([{ code: EX_TEMPFAIL, output: '' }], github(47 + 59 / 60)).options), 0);
  assert.equal(await runScheduledJob(args, githubEnv, harness([{ code: EX_TEMPFAIL, output: '' }], github(48 + 1 / 60)).options), 1);
});

test('any other failure (auth, config, our bug, bad archive) is red at once, never retried', async () => {
  for (const code of [1, 2, 127]) {
    const run = harness([{ code, output: 'ETIMEDOUT appears but --npm-output is off' }]);
    assert.equal(await runScheduledJob(args, githubEnv, run.options), 1);
    assert.equal(run.runs(), 1); assert.deepEqual(run.sleeps, []);
    assert.match(run.output.join('\n'), /::error::db-backup: failed \(exit/);
  }
});

test('npm registry outages are recognised from pnpm output; lockfile, integrity and 404s are ours', async () => {
  for (const text of ['ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/next: request to https://registry.npmjs.org/next failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org', 'ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/react: Service Unavailable - 503', 'ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint (at https://registry.npmjs.org/-/npm/v1/security/audits/quick) responded with 503: Service Unavailable', 'request to https://registry.npmjs.org/x failed, reason: socket hang up', 'connect ETIMEDOUT 104.16.0.35:443'])
    assert.equal(isNpmOutage(text), true, text);
  for (const text of ['ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile"', 'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/not-a-package: Not Found - 404', 'ERR_PNPM_TARBALL_INTEGRITY  Got unexpected checksum', 'ERR_PNPM_FETCH_401 Unauthorized', '3 vulnerabilities found'])
    assert.equal(isNpmOutage(text), false, text);
  const install = ['--job', 'dependency-install', '--stale-after-hours=72', '--npm-output', '--', 'pnpm', 'install'];
  const env = { ...githubEnv, GITHUB_WORKFLOW_REF: 'owner/apex-f1/.github/workflows/db-backup.yml@refs/heads/main' };
  const down = harness([{ code: 1, output: 'ERR_PNPM_META_FETCH_FAIL ... reason: connect ECONNRESET' }]);
  assert.equal(await runScheduledJob(install, env, down.options), 0); assert.equal(down.runs(), 3);
  const ours = harness([{ code: 1, output: 'ERR_PNPM_OUTDATED_LOCKFILE' }]);
  assert.equal(await runScheduledJob(install, env, ours.options), 1); assert.equal(ours.runs(), 1);
});

test('retries stay inside the run budget', async () => {
  let clock = NOW;
  const run = harness([{ code: EX_TEMPFAIL, output: '' }]);
  run.options.now = () => clock;
  run.options.run = async () => { clock += 4 * 60_000; return { code: EX_TEMPFAIL, output: '' }; }; // each attempt takes 4 min
  run.options.sleep = async (ms) => { run.sleeps.push(ms); clock += ms; };
  assert.equal(await runScheduledJob(args, githubEnv, run.options), 0);
  assert.deepEqual(run.sleeps, [30_000], 'the 90 s wait after a second 4-minute attempt would pass the 7-minute budget');
});

test('malformed arguments fail red before running anything', async () => {
  for (const bad of [[], ['--job', 'db-backup', '--', 'x'], ['--job', 'Bad Name', '--stale-after-hours=48', '--', 'x'], ['--job', 'db-backup', '--stale-after-hours=0', '--', 'x'], ['--job', 'db-backup', '--stale-after-hours=48']]) {
    const run = harness([{ code: 0, output: '' }]);
    assert.equal(await runScheduledJob(bad, githubEnv, run.options), 1);
    assert.equal(run.runs(), 0);
  }
});

test('lastVerifiedSuccess only trusts the marker step of this workflow', async () => {
  const gh = github(3);
  assert.equal(await lastVerifiedSuccess(githubEnv, gh.fetchImpl), NOW - 3 * HOUR);
  assert.ok(gh.calls.every((url) => /^https:\/\/api\.github\.com\/repos\/owner\/apex-f1(?:\/|$)/.test(url)), gh.calls.join(' '));
  assert.equal(await lastVerifiedSuccess({ ...githubEnv, GITHUB_WORKFLOW_REF: 'garbage' }, gh.fetchImpl), null);
  assert.equal(await lastVerifiedSuccess(githubEnv, async () => { throw new TypeError('fetch failed'); }), null);
});

test('backup: pg_dump connection failures are Supabase outages; auth, TLS and permission errors are not', () => {
  for (const text of ['pg_dump: error: connection to server at "aws-0-eu.pooler.supabase.com" (3.1.2.3), port 5432 failed: Connection refused', 'pg_dump: error: could not translate host name "aws-0.pooler.supabase.com" to address: Temporary failure in name resolution', 'pg_dump: error: connection to server failed: timeout expired', 'FATAL:  the database system is starting up', 'FATAL: remaining connection slots are reserved for non-replication superuser connections', 'server closed the connection unexpectedly'])
    assert.equal(isDatabaseOutageText(text), true, text);
  for (const text of ['FATAL:  password authentication failed for user "apex_owner"', 'connection to server failed: SSL error: certificate verify failed', 'pg_dump: error: query failed: ERROR:  permission denied for schema drizzle', 'pg_dump: error: schema "drizzle" does not exist'])
    assert.equal(isDatabaseOutageText(text), false, text);
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isStorageOutageStatus(status), true);
  for (const status of [400, 401, 403, 404, 409]) assert.equal(isStorageOutageStatus(status), false);
});

test('backup: Storage unreachable or 5xx is an outage (exit 75 path); 401 is a configuration failure', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { SUPABASE_BACKUP_DB_URL: 'postgresql://apex_owner.ref:synthetic-password@pooler.invalid:5432/postgres', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' });
  delete process.env.SUPABASE_DB_CA_PATH;
  try {
    for (const [respond, outage] of [
      [async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }, true],
      [async () => new Response('<html>502</html>', { status: 502 }), true],
      [async () => new Response('{"message":"rate limited"}', { status: 429 }), true],
      [async () => new Response('{"message":"Invalid JWT"}', { status: 401 }), false],
    ]) {
      globalThis.fetch = respond;
      const error = await runBackup({ log: () => {} }).then(() => assert.fail('must fail'), (failure) => failure);
      assert.ok(error instanceof BackupError);
      assert.equal(error.outage, outage, error.message);
      assert.doesNotMatch(error.message, /synthetic-password|synthetic-service-key/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ['SUPABASE_BACKUP_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

test('dependency audit: a registry outage is reported apart from an audit failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'apex-audit-'));
  try {
    await writeFile(path.join(root, 'package.json'), '{}');
    await mkdir(path.join(root, 'scripts'), { recursive: true });
    const commands = (auditResult) => async (args) => {
      if (args.includes('--version')) return { code: 0, stdout: '10.33.0\n', stderr: '' };
      if (args.includes('audit')) return auditResult;
      return { code: 0, stdout: '', stderr: '' };
    };
    const outage = await runDependencyAudit({ root, cli: '/x/pnpm.cjs', command: commands({ code: 1, stdout: '', stderr: 'ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint (at https://registry.npmjs.org/-/npm/v1/security/audits/quick) responded with 503: Service Unavailable' }) });
    assert.equal(outage.ready, false); assert.equal(outage.registryUnavailable, true);
    const timedOut = await runDependencyAudit({ root, cli: '/x/pnpm.cjs', command: commands({ code: null, signal: 'SIGKILL', timedOut: true, stdout: '', stderr: '' }) });
    assert.equal(timedOut.registryUnavailable, true);
    const broken = await runDependencyAudit({ root, cli: '/x/pnpm.cjs', command: commands({ code: 1, stdout: 'not json', stderr: '' }) });
    assert.equal(broken.ready, false); assert.equal(broken.registryUnavailable, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------- Independent review 2026-10-31 (docs/audit/2026-10-31/cron-review.md) ----------
import { runCommand } from './scheduled-job.mjs';

/** Fake GitHub API for F-03: the runs listing honours branch/event filters like the real one. */
function githubRuns(runs, { defaultBranch = 'main' } = {}) {
  const queries = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/repos/owner/apex-f1') return Response.json({ default_branch: defaultBranch });
    if (/\/actions\/workflows\/db-backup\.yml\/runs$/.test(parsed.pathname)) {
      queries.push(parsed.search);
      const branch = parsed.searchParams.get('branch'), event = parsed.searchParams.get('event');
      return Response.json({ workflow_runs: runs.filter((run) => (!branch || run.head_branch === branch) && (!event || run.event === event)) });
    }
    const jobs = /\/actions\/runs\/(\d+)\/jobs/.exec(parsed.pathname);
    if (jobs) {
      const run = runs.find((item) => item.id === Number(jobs[1]));
      return Response.json({ jobs: [{ steps: [{ name: SUCCESS_MARKER_STEP, conclusion: 'success', completed_at: run.completed }] }] });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, queries };
}
const legit = { id: 7, event: 'schedule', head_branch: 'main', head_repository: { full_name: 'owner/apex-f1' }, path: '.github/workflows/db-backup.yml', completed: new Date(NOW - 3 * HOUR).toISOString() };

test('review F-03 E4: a fork pull_request run, another branch or another workflow file never counts as a verified success', async () => {
  for (const planted of [
    { ...legit, id: 8, event: 'pull_request', head_branch: 'attacker', head_repository: { full_name: 'evil/r' } },
    { ...legit, id: 9, event: 'pull_request', head_branch: 'main', head_repository: { full_name: 'evil/r' } },
    { ...legit, id: 10, event: 'push', head_branch: 'main' },
    { ...legit, id: 11, event: 'workflow_dispatch', head_branch: 'feature' },
    { ...legit, id: 12, event: 'schedule', head_branch: 'main', head_repository: { full_name: 'evil/r' } },
    { ...legit, id: 13, event: 'schedule', path: '.github/workflows/copy.yml' },
  ]) {
    const gh = githubRuns([planted]);
    assert.equal(await lastVerifiedSuccess(githubEnv, gh.fetchImpl), null, JSON.stringify(planted));
  }
  for (const event of ['schedule', 'workflow_dispatch']) {
    const gh = githubRuns([{ ...legit, event }]);
    assert.equal(await lastVerifiedSuccess(githubEnv, gh.fetchImpl), NOW - 3 * HOUR, event);
    assert.ok(gh.queries.every((query) => /branch=main/.test(query) && /event=(?:schedule|workflow_dispatch)/.test(query)), gh.queries.join(' '));
  }
  // The newest verified run wins across both events.
  const both = githubRuns([{ ...legit, id: 20, completed: new Date(NOW - 30 * HOUR).toISOString() }, { ...legit, id: 21, event: 'workflow_dispatch', completed: new Date(NOW - 2 * HOUR).toISOString() }]);
  assert.equal(await lastVerifiedSuccess(githubEnv, both.fetchImpl), NOW - 2 * HOUR);
});

test('review F-07: the wrapped command never receives GITHUB_TOKEN', async () => {
  const quiet = { write: () => true };
  const result = await runCommand([process.execPath, '-e', 'process.stdout.write(process.env.GITHUB_TOKEN ? "token-present" : "token-absent")'], { env: { ...process.env, GITHUB_TOKEN: 'synthetic-token' }, stdout: quiet, stderr: quiet });
  assert.equal(result.code, 0);
  assert.match(result.output, /token-absent/);
  assert.doesNotMatch(result.output, /synthetic-token/);
});
