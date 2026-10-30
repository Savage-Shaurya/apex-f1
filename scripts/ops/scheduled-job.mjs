#!/usr/bin/env node
// Outage policy for scheduled GitHub jobs that are not cron routes (db-backup, dependency-security).
//
//   node scripts/ops/scheduled-job.mjs --job db-backup --stale-after-hours=48 -- node scripts/ops/backup-db.mjs
//   node scripts/ops/scheduled-job.mjs --job dependency-security --stale-after-hours=72 --npm-output -- pnpm install ...
//
// The same contract as scripts/invoke-cron.mjs (DEPLOY.md "Cron outcomes"):
//   - the command succeeds                        -> exit 0, step output outcome=ok
//   - it reports an upstream outage (exit 75, EX_TEMPFAIL; or, with --npm-output,
//     a registry/network failure in its output)   -> retried after 30 s and 90 s inside a
//     7-minute budget; still down -> exit 0 + ::warning:: + summary (outcome=deferred) while the
//     job's last VERIFIED success is recent, else exit 1 + ::error::
//   - anything else (auth, config, our bug, bad data) -> exit 1 at once
//
// The last verified success is the newest run of this workflow whose step named
// "Record verified success" concluded success (GitHub REST API, GITHUB_TOKEN with actions:read).
// A green-with-warning run never runs that step, so it never counts. Unknown -> red.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EX_TEMPFAIL = 75;
export const SUCCESS_MARKER_STEP = 'Record verified success';
export const RETRY_DELAYS_MS = [30_000, 90_000];
export const RUN_BUDGET_MS = 7 * 60_000;
const HOUR_MS = 3_600_000;
const JOB = /^[a-z0-9-]{1,40}$/;

/**
 * npm/pnpm output that means the registry or the network is unavailable, as
 * opposed to a lockfile, integrity, auth or package error (always ours).
 */
const NPM_OUTAGE = /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ERR_SOCKET_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|socket hang up)\b|ERR_PNPM_(?:META_FETCH_FAIL|FETCH_(?:5\d\d|429|408)|AUDIT_BAD_RESPONSE)\b[^\n]*?(?:\b(?:5\d\d|429|408)\b|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN)|\bresponded with (?:5\d\d|429|408)\b|\b(?:502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b/i;
const NPM_OURS = /ERR_PNPM_(?:OUTDATED_LOCKFILE|LOCKFILE_|FETCH_40[0-4]|TARBALL_INTEGRITY|BAD_PM_VERSION|UNSUPPORTED_ENGINE)|EINTEGRITY|E40[134]\b/;

export function isNpmOutage(output) {
  const text = String(output ?? '');
  return NPM_OUTAGE.test(text) && !NPM_OURS.test(text);
}

export function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) throw new Error('Usage: scheduled-job.mjs --job <name> --stale-after-hours=<h> [--npm-output] -- <command> [args]');
  const own = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  let job = null, staleAfterHours = null, npmOutput = false;
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === '--job') job = own[++i];
    else if (arg.startsWith('--stale-after-hours=')) staleAfterHours = Number(arg.slice(20));
    else if (arg === '--npm-output') npmOutput = true;
    else throw new Error(`Unknown option ${arg}.`);
  }
  if (!job || !JOB.test(job)) throw new Error('--job must be a short lowercase name.');
  if (!Number.isInteger(staleAfterHours) || staleAfterHours < 1 || staleAfterHours > 720) throw new Error('--stale-after-hours must be 1-720.');
  return { job, staleAfterHours, npmOutput, command };
}

/** Only this wrapper asks GitHub for the last verified run; the wrapped command never needs the token (review F-07). */
const WRAPPER_ONLY_ENV = ['GITHUB_TOKEN', 'GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'];

/** Run a command with inherited output, keeping the last 16 KB for classification only (never printed again). */
export function runCommand([tool, ...args], { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const childEnv = { ...env };
  for (const name of WRAPPER_ONLY_ENV) delete childEnv[name];
  return new Promise((resolve) => {
    const child = spawn(tool, args, { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (chunk, stream) => { stream.write(chunk); tail = (tail + chunk.toString('utf8')).slice(-16_384); };
    child.stdout.on('data', (chunk) => keep(chunk, stdout));
    child.stderr.on('data', (chunk) => keep(chunk, stderr));
    child.on('error', (error) => resolve({ code: 127, output: `spawn ${error.code ?? 'error'}` }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 : 1), output: tail }));
  });
}

/** Only these runs can prove a real backup or audit happened (review F-03). */
const TRUSTED_EVENTS = ['schedule', 'workflow_dispatch'];

/**
 * Newest verified success of this workflow (epoch ms), or null when none is on
 * record or GitHub cannot say. Only runs of THIS workflow file, from this
 * repository's default branch, started by `schedule` or `workflow_dispatch`
 * count: a fork pull request or a branch that edits the workflow cannot plant
 * a "Record verified success" step (review F-03).
 */
export async function lastVerifiedSuccess(env, fetchImpl = fetch, { maxRuns = 10, timeoutMs = 10_000 } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN;
  const workflow = /\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)@/.exec(env.GITHUB_WORKFLOW_REF ?? '')?.[1];
  if (!repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || !token || !workflow) return null;
  const get = async (route) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}${route}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
    return response.json();
  };
  try {
    const repository = await get('');
    const branch = typeof repository?.default_branch === 'string' && /^[A-Za-z0-9._/-]{1,200}$/.test(repository.default_branch) ? repository.default_branch : null;
    if (!branch) return null;
    const listings = await Promise.all(TRUSTED_EVENTS.map((event) =>
      get(`/actions/workflows/${encodeURIComponent(workflow)}/runs?status=success&branch=${encodeURIComponent(branch)}&event=${event}&per_page=${maxRuns}`)));
    const trusted = listings
      .flatMap((listing) => (Array.isArray(listing?.workflow_runs) ? listing.workflow_runs : []))
      .filter((run) => Number.isSafeInteger(run?.id) && TRUSTED_EVENTS.includes(run.event) && run.head_branch === branch
        && run.head_repository?.full_name === repo && typeof run.path === 'string' && run.path.replace(/@.*$/, '') === `.github/workflows/${workflow}`)
      .sort((a, b) => (Date.parse(b.created_at ?? '') || b.id) - (Date.parse(a.created_at ?? '') || a.id));
    let newest = null;
    for (const run of trusted.slice(0, maxRuns)) {
      const jobs = await get(`/actions/runs/${run.id}/jobs?per_page=20`);
      for (const job of Array.isArray(jobs?.jobs) ? jobs.jobs : []) {
        const marker = (Array.isArray(job?.steps) ? job.steps : []).find((step) => step?.name === SUCCESS_MARKER_STEP && step?.conclusion === 'success');
        const at = Date.parse(marker?.completed_at ?? '');
        if (Number.isFinite(at) && (newest === null || at > newest)) newest = at;
      }
    }
    return newest;
  } catch {
    return null;
  }
}

export async function runScheduledJob(argv, env, {
  run = runCommand, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
  log = console.log, errorLog = console.error,
  appendSummary = (text) => { if (env.GITHUB_STEP_SUMMARY) try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`); } catch { /* convenience only */ } },
  setOutput = (name, value) => { if (env.GITHUB_OUTPUT) try { appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`); } catch { /* checked by the next step's condition */ } },
  budgetMs = RUN_BUDGET_MS, attemptAllowanceMs = 60_000,
} = {}) {
  let options;
  try { options = parseArgs(argv); }
  catch (error) { errorLog(`::error::${error.message}`); return 1; }
  const { job, staleAfterHours, npmOutput, command } = options;
  const started = now();
  for (let attempt = 0; ; attempt++) {
    const result = await run(command, { env });
    if (result.code === 0) { setOutput('outcome', 'ok'); return 0; }
    const outage = result.code === EX_TEMPFAIL || (npmOutput && isNpmOutage(result.output));
    if (!outage) {
      const message = `${job}: failed (exit ${result.code}); not an upstream outage, so it is not retried.`;
      errorLog(`::error::${message}`);
      appendSummary(`- ❌ ${message}`);
      return 1;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined && now() - started + delay + attemptAllowanceMs <= budgetMs) {
      log(`[job] ${job}: upstream unavailable (attempt ${attempt + 1}); retrying in ${delay / 1000} s.`);
      await sleep(delay);
      continue;
    }
    break;
  }
  const last = await lastVerifiedSuccess(env, fetchImpl);
  const ageHours = last === null ? null : Math.max(0, now() - last) / HOUR_MS;
  if (ageHours !== null && ageHours <= staleAfterHours) {
    const message = `${job}: upstream unavailable after retries; deferred to the next scheduled run. Last verified success ${new Date(last).toISOString()} (${ageHours.toFixed(1)} h ago, limit ${staleAfterHours} h).`;
    log(`::warning::${message}`);
    appendSummary(`- ⚠️ ${message}`);
    setOutput('outcome', 'deferred');
    return 0;
  }
  const message = last === null
    ? `${job}: upstream unavailable and no verified success on record (or GitHub could not be asked); failing so a prolonged breakage is noticed.`
    : `${job}: upstream unavailable; last verified success ${new Date(last).toISOString()} is ${ageHours.toFixed(1)} h old, over the ${staleAfterHours} h limit.`;
  errorLog(`::error::${message}`);
  appendSummary(`- ❌ ${message}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runScheduledJob(process.argv.slice(2), process.env);
}
