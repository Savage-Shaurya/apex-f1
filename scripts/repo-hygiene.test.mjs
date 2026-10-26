// Public-repository hygiene (final audit 2026-10-26, F-17).
//
// The public repository carries the product source and its operating docs
// only: no design-reference dumps, strategy/founder/audit material or
// generated reports, a README for a fresh reader, a complete
// apps/web/.env.example, ignore rules for env files, secrets, build output,
// backups and reports, and no tracked file that a build rewrites
// (apps/web/next-env.d.ts depends on the Next distDir).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportRelease, releaseFiles } from './ops/export-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const inGit = (() => { try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim() === root; } catch { return false; } })();

/** Internal material that stays in the private workspace. */
const PRIVATE_PATHS = [
  'audit',
  'APEX_F1_PID_PRD.md', 'FORMULA1_STARTUP_PHASE1_PID.md', 'FORMULA1_SYSTEM_DESIGN_PLAN.md', 'APEX_MASTERCLASS.html',
  'a_futuristic_formula_1_pit_lane_at_night_glowing_telemetry_screens_mechanics_in',
  'cinematic_high_speed_motion_blur_of_multiple_formula_1_cars_racing_through_a',
  'intense_vertical_close_up_of_a_formula_1_driver_s_helmet_reflecting_the_lights',
  'apex_news_hub_navigation', 'driver_profile_high_prestige', 'race_lab_deep_dive', 'race_lab_mission_control_analysis',
  'the_archive_high_volume_databank', 'the_archive_news_gallery', 'the_grid_24_7_global_feed', 'the_grid_homepage', 'velocity_verse',
  'docs/audit', 'docs/strategy', 'docs/founder', 'docs/redesign', 'docs/design', 'docs/providers',
];

test('internal design references, strategy, founder and audit material are not in the repository', () => {
  const present = PRIVATE_PATHS.filter((relative) => existsSync(path.join(root, relative)));
  assert.deepEqual(present, []);
  // Only product folders and known root files remain at the top level.
  const allowedRoot = new Set(['.git', '.github', '.gitignore', '.npmrc', '.nvmrc', '.vercel', '.vercelignore', 'CLAUDE.md', 'DEPLOY.md', 'LICENSE', 'README.md',
    'apps', 'docs', 'node_modules', 'package.json', 'packages', 'patches', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts',
    'tsconfig.base.json', 'turbo.json', 'RELEASE-MANIFEST.json', '.turbo', '.cache', '.DS_Store',
    // Git-ignored output of `pnpm audit:checked`, which CI runs before the tests; the
    // export and ignore-rule tests below keep it out of the published tree.
    'dependency-security-reports']);
  const extra = readdirSync(root).filter((name) => !allowedRoot.has(name));
  assert.deepEqual(extra, [], 'unexpected top-level entries');
});

test('the README is written for a fresh public reader: product, stack, setup, scripts, quality gate and deploy, with no internal history', () => {
  const readme = read('README.md');
  for (const section of [/^## Stack/m, /^## Local setup/m, /^## Scripts/m, /^## Quality gate/m, /^## Deploy/m]) assert.match(readme, section);
  assert.match(readme, /apps\/web\/\.env\.example/);
  for (const command of ['pnpm install --frozen-lockfile', 'pnpm dev', 'pnpm typecheck', 'pnpm test', 'pnpm lint', 'pnpm build', 'pnpm qa:gate']) assert.ok(readme.includes(command), command);
  assert.doesNotMatch(readme, /\/Users\/|audit\/20|September 2026|supplied database|PID|PRD|pending user approval|strategy|founder/i);
  assert.doesNotMatch(readme, /(?:phc_|sk_live|re_[A-Za-z0-9]{8,}|ghp_)[A-Za-z0-9]{8,}/, 'no key-shaped values');
  for (const link of readme.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) assert.ok(existsSync(path.join(root, link[1])), `README links to missing ${link[1]}`);
});

/** Every environment variable the source reads, the workflows pass, or the CI sets up. */
function variablesReadBySource() {
  const names = new Set();
  const skipDir = new Set(['node_modules', '.next', '.turbo', 'tests', 'fixtures', '.git', 'dist']);
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      if (skipDir.has(name) || name.startsWith('.next-')) continue;
      const file = path.join(directory, name);
      const info = statSync(file);
      if (info.isDirectory()) walk(file);
      else if (/\.(?:[cm]?[jt]sx?|mts|ya?ml)$/.test(name) && !/\.test\./.test(name)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]|\benv\.([A-Z][A-Z0-9_]{2,})\b|\$\{\{\s*(?:secrets|vars)\.([A-Z][A-Z0-9_]{2,})/g)) names.add(m[1] ?? m[2] ?? m[3] ?? m[4]);
        for (const m of text.matchAll(/resolveProviderBase\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g)) names.add(m[1]);
      }
    }
  };
  for (const dir of ['apps/web', 'apps/workers/src', 'packages', 'scripts', '.github/workflows']) walk(path.join(root, dir));
  return names;
}
/** Set by the platform, Node or the test runner, never by an operator. */
const PLATFORM = new Set(['NODE_ENV', 'NODE_OPTIONS', 'NEXT_PHASE', 'NEXT_RUNTIME', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION',
  'VERCEL_GIT_COMMIT_SHA', 'VERCEL_PROJECT_PRODUCTION_URL', 'GITHUB_TOKEN', 'GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'RUNNER_TEMP', 'CI', 'HOME', 'PATH']);

test('apps/web/.env.example names every variable the source reads, with an explanation and no values', () => {
  const example = read('apps/web/.env.example');
  const missing = [...variablesReadBySource()].filter((name) => !PLATFORM.has(name) && !new RegExp(`(?:^|[\\s#])${name}(?:=|\\b)`, 'm').test(example)).sort();
  assert.deepEqual(missing, [], 'variables missing from apps/web/.env.example');
  for (const name of ['NEXT_PUBLIC_SITE_URL', 'CRON_SECRET', 'SUPABASE_BACKUP_DB_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APEX_SITE_URL', 'NEXT_PUBLIC_POSTHOG_KEY']) assert.match(example, new RegExp(`\\b${name}\\b`), name);
  const lines = example.split('\n');
  lines.forEach((line, index) => {
    const assignment = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!assignment) return;
    const [, name, value] = assignment;
    // Only non-secret switches carry a default; secrets, keys and URLs are blank.
    assert.ok(value === '' || /^(?:true|false|0|1)$/.test(value), `${name} has a value in the template`);
    const comments = lines.slice(Math.max(0, index - 12), index).filter((l) => l.startsWith('#'));
    assert.ok(comments.length > 0, `${name} has no explanation above it`);
  });
});

test('.gitignore covers env files, secrets, build output, backups and reports, and keeps .env.example', { skip: !inGit && 'not a git checkout' }, () => {
  const ignored = (relative) => { try { execFileSync('git', ['check-ignore', '-q', '--no-index', relative], { cwd: root }); return true; } catch { return false; } };
  for (const relative of ['.env', 'apps/web/.env.local', 'apps/web/.env.production', 'apps/web/.env.development.local', '.secrets/production.env', 'apps/web/.secrets/x',
    'apps/web/.next/server/app.js', 'apps/web/.next-auditfix/server/app.js', '.turbo/cache/x', 'apps/web/.turbo/x', 'apps/web/next-env.d.ts', 'apps/web/tsconfig.tsbuildinfo',
    'dependency-security-reports/full.json', 'apps/web/tests/quality-gate/.reports/run.json', 'reports/run.json', 'apps/web/coverage/x',
    'backups/apex-2026-10-26.dump', 'db.dump', 'apex.sql.gz', 'notes.bak', 'APEX_SECRETS_BACKUP.txt', 'apps/web/debug.log', '.vercel/project.json', '.cache/provider/x']) {
    assert.ok(ignored(relative), `${relative} is not ignored`);
  }
  for (const relative of ['apps/web/.env.example', 'apps/web/app/page.tsx', 'packages/db/migrations/0000_init.sql', 'scripts/ops/backup-db.mjs', 'docs/operations/release-config.example.json']) {
    assert.ok(!ignored(relative), `${relative} must stay tracked`);
  }
});

test('no tracked file is rewritten by a build: next-env.d.ts is generated, and typecheck generates it first', { skip: !inGit && 'not a git checkout' }, () => {
  const tracked = execFileSync('git', ['ls-files', 'apps/web/next-env.d.ts'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(tracked, '', 'apps/web/next-env.d.ts is tracked; a build with APEX_NEXT_DIST_DIR rewrites it');
  const scripts = JSON.parse(read('apps/web/package.json')).scripts;
  assert.match(scripts.typecheck, /^next typegen && tsc --noEmit$/, 'typecheck must not depend on a previous build or dev run');
});

test('the public export contains the product and its docs only', async () => {
  for (const file of releaseFiles) assert.ok(existsSync(path.join(root, file)), `export allowlist names missing ${file}`);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'apex-hygiene-'));
  try {
    const manifest = await exportRelease(root, path.join(parent, 'export'));
    const paths = manifest.files.map((f) => f.path);
    for (const needed of ['README.md', 'apps/web/.env.example', 'apps/web/package.json', 'pnpm-lock.yaml', 'docs/QUALITY-GATE.md', 'docs/NEWS-POLICY.md']) assert.ok(paths.includes(needed), `export lacks ${needed}`);
    const leaked = paths.filter((p) => /^CLAUDE\.md$|^audit\/|^docs\/(?:audit|strategy|founder|redesign|design|providers)\/|dependency-security-reports|\.env(?:\.|$)(?!example)|next-env\.d\.ts$|(?:^|\/)\.secrets\//.test(p));
    assert.deepEqual(leaked, []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
