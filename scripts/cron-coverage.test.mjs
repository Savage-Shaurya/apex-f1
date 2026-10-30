// Regression guards (cron resilience, 2026-10-31): a scheduled job cannot bypass the outage
// contract, and a new cron route cannot be added without outage tests.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUEST_TIMEOUT_MS, RUN_BUDGET_MS, STALE_AFTER_HOURS } from './invoke-cron.mjs';
import { RUN_BUDGET_MS as JOB_BUDGET_MS } from './ops/scheduled-job.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
/** Sends real email: only the hosting cron (vercel.json) may call it, never a workflow or the runner. */
const HOSTING_ONLY = new Set(['newsletter-blast']);

async function cronRoutes() {
  const entries = await readdir(path.join(root, 'apps/web/app/api/cron'), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
async function workflows() {
  const dir = path.join(root, '.github/workflows');
  const files = (await readdir(dir)).filter((name) => /\.ya?ml$/.test(name)).sort();
  return Promise.all(files.map(async (name) => ({ name, text: await readFile(path.join(dir, name), 'utf8') })));
}

test('every cron route is either covered by the outage matrix and the runner, or explicitly hosting-only', async () => {
  const routes = await cronRoutes();
  assert.ok(routes.length >= 6, routes.join(','));
  const matrix = await read('apps/web/tests/cron-outage-matrix.test.ts');
  const declared = /CRON_MATRIX_ROUTES = \[([^\]]+)\]/.exec(matrix)?.[1].match(/'([a-z-]+)'/g)?.map((name) => name.slice(1, -1)) ?? [];
  const invoker = await read('scripts/invoke-cron.mjs');
  const runnerRoutes = /const ROUTES = new Set\(\[([^\]]+)\]\)/.exec(invoker)?.[1].match(/"([a-z-]+)"/g)?.map((name) => name.slice(1, -1)) ?? [];
  for (const route of routes) {
    if (HOSTING_ONLY.has(route)) {
      assert.ok(!declared.includes(route) && !runnerRoutes.includes(route), `${route} must stay hosting-only`);
      continue;
    }
    assert.ok(declared.includes(route), `${route} is missing from CRON_MATRIX_ROUTES in apps/web/tests/cron-outage-matrix.test.ts: add its outage cases`);
    assert.ok(runnerRoutes.includes(route), `${route} is not schedulable through scripts/invoke-cron.mjs`);
    assert.ok(Number.isInteger(STALE_AFTER_HOURS[route]), `${route} has no staleness threshold in STALE_AFTER_HOURS`);
    // The matrix must actually build at least one target for the route.
    assert.match(matrix, new RegExp(`route: '${route}'`), `${route} has no target in the outage matrix`);
  }
  for (const route of [...declared, ...runnerRoutes]) assert.ok(routes.includes(route), `${route} is listed but has no route directory`);
});

test('every route handler answers outages through the shared contract (runLeasedCron + cron-outcome)', async () => {
  for (const route of await cronRoutes()) {
    if (HOSTING_ONLY.has(route)) continue;
    const source = await read(`apps/web/app/api/cron/${route}/route.ts`);
    assert.match(source, /runLeasedCron\(/, `${route} must run through runLeasedCron (lastSuccessAt bookkeeping)`);
  }
  // Each provider-reading task builds the 503 contract through the one helper.
  for (const file of ['apps/web/app/api/cron/weather-sync/route.ts', 'apps/web/app/api/cron/weekend-watch/route.ts', 'apps/web/app/api/cron/rss-sync/route.ts', 'apps/web/lib/youtube-cron.ts', 'apps/web/lib/season-cron.ts', 'apps/web/lib/leased-cron.ts'])
    assert.match(await read(file), /providerUnavailableResponse\(/, `${file} must use providerUnavailableResponse`);
});

test('scheduled workflows reach crons only through invoke-cron.mjs and other jobs only through scheduled-job.mjs', async () => {
  const scheduled = (await workflows()).filter((workflow) => /^\s*schedule:/m.test(workflow.text));
  assert.ok(scheduled.length >= 7, scheduled.map((workflow) => workflow.name).join(','));
  for (const { name, text: raw } of scheduled) {
    // Comments may describe the routes; only the executable YAML is checked.
    const text = raw.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
    const runs = [...text.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1]);
    assert.doesNotMatch(text, /\b(?:curl|wget|Invoke-WebRequest)\b/, `${name} must not call endpoints directly`);
    assert.doesNotMatch(text, /\/api\/cron\//, `${name} must not name a cron URL; use scripts/invoke-cron.mjs <route>`);
    for (const match of text.matchAll(/node scripts\/invoke-cron\.mjs ([a-z-]+)/g))
      assert.ok(!HOSTING_ONLY.has(match[1]), `${name} must not schedule ${match[1]}`);
    const usesRunner = /node scripts\/invoke-cron\.mjs [a-z-]+/.test(text);
    const usesJob = /node scripts\/ops\/scheduled-job\.mjs --job [a-z-]+ --stale-after-hours=\d+/.test(text);
    assert.ok(usesRunner || usesJob, `${name} runs its scheduled work outside the outage contract`);
    const timeoutMs = Number(/timeout-minutes: (\d+)/.exec(text)?.[1]) * 60_000;
    if (usesRunner) {
      assert.ok(timeoutMs >= RUN_BUDGET_MS + REQUEST_TIMEOUT_MS + 90_000, `${name}: timeout-minutes too short for in-run retries`);
      assert.ok(runs.filter((line) => /invoke-cron/.test(line)).every((line) => /^node scripts\/invoke-cron\.mjs [a-z-]+(?: --until-complete=\d+)?$/.test(line.trim())), `${name}: invoke-cron must be the whole command (no || true, no pipes)`);
    }
    if (usesJob) {
      assert.match(text, /actions: read/, `${name} needs actions: read to find its last verified success`);
      assert.match(text, /- name: Record verified success\n\s+if: steps\.[a-z-]+\.outputs\.outcome == 'ok'/, `${name} needs the verified-success marker step, gated on outcome == 'ok'`);
      assert.ok(timeoutMs >= 2 * (JOB_BUDGET_MS + 60_000), `${name}: timeout-minutes too short for in-run retries`);
    }
    assert.doesNotMatch(text, /continue-on-error:\s*true/, `${name} must not hide failures`);
  }
});

// Review F-05: each staleness limit must cover the longest gap between the job's own scheduled
// runs plus one day of outage tolerance, or a healthy job goes red on its first failing run.
function cronMatches(expression, date) {
  const [minute, hour, dom, month, dow] = expression.trim().split(/\s+/);
  const field = (spec, value, min, max) => spec.split(',').some((part) => {
    const [range, stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    let [from, to] = range === '*' ? [min, max] : range.split('-').map(Number);
    if (to === undefined) to = stepText ? max : from;
    return value >= from && value <= to && (value - from) % step === 0;
  });
  return field(minute, date.getUTCMinutes(), 0, 59) && field(hour, date.getUTCHours(), 0, 23) && field(dom, date.getUTCDate(), 1, 31) && field(month, date.getUTCMonth() + 1, 1, 12) && field(dow, date.getUTCDay(), 0, 6);
}
function longestGapHours(expressions) {
  const start = Date.UTC(2026, 10, 2); // Monday 2026-11-02, two full weeks
  let previous = null, longest = 0;
  for (let at = start; at < start + 14 * 86_400_000; at += 60_000) {
    const date = new Date(at);
    if (!expressions.some((expression) => cronMatches(expression, date))) continue;
    if (previous !== null) longest = Math.max(longest, (at - previous) / 3_600_000);
    previous = at;
  }
  return longest;
}

test('review F-05: every staleness limit covers its schedule gap + 24 h', async () => {
  assert.equal(longestGapHours(['4-54/10 * * * 5,6,0', '4-54/10 0-6 * * 1']), 89 + 10 / 60, 'Monday 06:54 -> Friday 00:04');
  for (const { name, text } of await workflows()) {
    if (!/^\s*schedule:/m.test(text)) continue;
    const crons = [...text.matchAll(/cron: ["']([^"']+)["']/g)].map((match) => match[1]);
    const gap = longestGapHours(crons);
    for (const match of text.matchAll(/node scripts\/invoke-cron\.mjs ([a-z-]+)/g))
      assert.ok(STALE_AFTER_HOURS[match[1]] >= gap + 24, `${name}: ${match[1]} limit ${STALE_AFTER_HOURS[match[1]]} h < gap ${gap.toFixed(1)} h + 24 h`);
    for (const match of text.matchAll(/--stale-after-hours=(\d+)/g))
      assert.ok(Number(match[1]) >= gap + 24, `${name}: limit ${match[1]} h < gap ${gap.toFixed(1)} h + 24 h`);
  }
});

test('review F-07: GITHUB_TOKEN only reaches scheduled-job.mjs, never another command in its step', async () => {
  for (const { name, text } of await workflows()) {
    for (const step of text.split(/\n\s*- (?=name:|uses:)/)) {
      if (!/^\s*GITHUB_TOKEN:/m.test(step)) continue;
      assert.match(step, /node scripts\/ops\/scheduled-job\.mjs/, `${name}: a step with GITHUB_TOKEN must be a scheduled-job.mjs step`);
      const commands = step.split('\n').filter((line) => !/^\s*#/.test(line) && /\b(?:node|pnpm|npx|bash|sh|curl)\b/.test(line) && !/^\s*(?:run|name|[A-Z_]+):\s*$/.test(line));
      for (const line of commands)
        assert.ok(/scheduled-job\.mjs/.test(line) || /env -u GITHUB_TOKEN/.test(line), `${name}: "${line.trim()}" would inherit GITHUB_TOKEN`);
    }
  }
});
