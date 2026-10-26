#!/usr/bin/env node
/**
 * Apex quality gate. One command, every problem class found by the audits.
 *
 *   APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate          # full
 *   APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate:quick    # CI: static + unit + selftest + 1440/390 smoke
 *   pnpm qa:gate -- --only=matrix,a11y                            # some checks
 *
 * Checks: static, unit, selftest, matrix, a11y, keyboard, history, data, links.
 * Writes apps/web/tests/quality-gate/.reports/gate-<time>.json and exits 1 on any failure.
 * Nothing is skipped silently: a check that cannot run is reported as an error.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { axeSource, checkRoute, launchBrowser, newContext, settle } from './lib/browser.mjs';
import { renderedFacts, scanRendered } from './lib/forbidden.mjs';
import { scanRepo } from './lib/static-scan.mjs';
import { historyFlow, keyboardFlow, linkCrawl } from './lib/flows.mjs';
import { VARIANTS, startFixtureServer } from './lib/fixtures.mjs';
import { compareOrderedRows, expectClassification, expectConstructorStandings, expectDriverStandings, jolpica, jolpicaAny, latestTeams, standingsPaths, tableRows } from './lib/data-truth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const QUICK = Boolean(args.quick);
const BASE = (process.env.APEX_QA_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const ALL = ['static', 'unit', 'selftest', 'matrix', 'a11y', 'keyboard', 'history', 'data', 'links'];
const CHECKS = args.only ? String(args.only).split(',') : QUICK ? ['static', 'unit', 'selftest', 'matrix'] : ALL;
const WIDTHS = QUICK ? [1440, 390] : [320, 390, 768, 820, 1024, 1440, 1920];
const CONCURRENCY = Number(process.env.APEX_QA_CONCURRENCY ?? 4);

const STATIC_ROUTES = ['/', '/latest', '/video', '/search?q=Leclerc', '/newsletter', '/schedule', '/results/archive', '/drivers', '/drivers/champions', '/drivers/all', '/drivers/hall-of-fame', '/teams', '/teams/champions', '/teams/all', '/live', '/live/timing', '/live/track', '/live/race-control', '/predict', '/about', '/contact', '/references', '/support', '/legal/privacy', '/legal/terms', '/legal/disclaimer', '/legal/dmca'];
const QUICK_ROUTES = ['/', '/schedule', '/drivers', '/teams', '/latest', '/support', '/about'];
const NOT_FOUND = '/this-page-is-not-on-the-timing-sheet';

const results = {};
const log = (s) => process.stdout.write(s + '\n');
function record(check, { passed = 0, failed = 0, problems = [], note = '' }) {
  results[check] = { passed, failed, problems, note };
  log(`${failed ? 'FAIL' : 'PASS'}  ${check.padEnd(9)} pass ${passed}  fail ${failed}${note ? '  (' + note + ')' : ''}`);
  // The same finding on many route x width cells is printed once with its cells.
  const grouped = new Map();
  for (const p of problems) { const k = `[${p.check}] ${p.detail}`; const g = grouped.get(k) ?? []; if (p.where) g.push(p.where); grouped.set(k, g); }
  const lines = [...grouped].sort((a, b) => b[1].length - a[1].length);
  for (const [k, where] of lines.slice(0, 60)) log(`      - ${k}${where.length ? `  <- ${where.length > 3 ? `${where.length} cells, e.g. ${where.slice(0, 3).join(', ')}` : where.join(', ')}` : ''}`);
  if (lines.length > 60) log(`      ... ${lines.length - 60} more distinct findings in the report`);
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }));
  return out;
}

/** Real example slugs from Jolpica (current season), so routes never hard-code a season or driver. */
async function dynamicRoutes() {
  const season = (await jolpica('/current.json')).RaceTable;
  const year = season.season;
  const last = (await jolpica('/current/last/results.json')).RaceTable.Races[0];
  const drivers = (await jolpicaAny(standingsPaths(year, 'driver'))).StandingsTable.StandingsLists[0]?.DriverStandings ?? [];
  const teams = (await jolpicaAny(standingsPaths(year, 'constructor'))).StandingsTable.StandingsLists[0]?.ConstructorStandings ?? [];
  const d = drivers[0]?.Driver.driverId; const t = teams[0]?.Constructor.constructorId;
  return [
    `/results/${year}`, `/results/${year}/drivers`, `/results/${year}/teams`, `/results/1976/drivers`, `/schedule/${year}`,
    last ? `/schedule/${year}/${last.Circuit.circuitId}-round-${last.round}` : null,
    d && `/drivers/${d}`, d && `/drivers/${d}/career`, '/drivers/senna', t && `/teams/${t}`, t && `/teams/${t}/history`,
  ].filter(Boolean);
}

async function runStatic() {
  const { files, hits } = await scanRepo();
  record('static', { passed: files - new Set(hits.map((h) => h.file)).size, failed: hits.length, problems: hits.map((h) => ({ check: h.rule, where: `${h.file}:${h.line}`, detail: `${h.why}: ${h.match}` })), note: `${files} source files` });
}

function runUnit() {
  const require = createRequire(path.join(REPO, 'apps/workers/package.json'));
  const files = ['apps/web/tests/quality-gate/forbidden.test.mjs', 'apps/web/tests/quality-gate/time.test.ts'];
  const r = spawnSync(process.execPath, [require.resolve('tsx/cli'), '--tsconfig', path.join(REPO, 'apps/web/tsconfig.json'), '--test', '--test-reporter=tap', ...files], { cwd: REPO, encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const pass = Number(out.match(/^# pass (\d+)/m)?.[1] ?? 0); const fail = Number(out.match(/^# fail (\d+)/m)?.[1] ?? (r.status ? 1 : 0));
  const problems = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => ({ check: 'unit', detail: m[1] }));
  if (r.status && !problems.length) problems.push({ check: 'unit', detail: out.slice(-600) });
  record('unit', { passed: pass, failed: fail, problems });
}

/** Proof that the gate catches each class: every broken fixture must fail its check, the clean ones must pass. */
async function runSelftest(browser) {
  const { server, base } = await startFixtureServer();
  const problems = []; let passed = 0;
  try {
    const layoutVariants = Object.entries(VARIANTS).filter(([k]) => !['reopen-menu', 'menu-fixed', 'sticky-search', 'search-fixed', 'dead-link', 'clean2', 'support', 'kb-broken', 'kb-good', 'kb-late', 'tabs-broken', 'tabs-late', 'kb-search-dead', 'kb-search-live'].includes(k));
    await pool(layoutVariants, CONCURRENCY, async ([name, v]) => {
      const r = await checkRoute(browser, `${base}/${name}`, 390, { axe: name === 'axe' || name === 'clean' ? axeSource() : null });
      const context = await newContext(browser, 390); const page = await context.newPage();
      await page.goto(`${base}/${name}`, { waitUntil: 'load' }); await settle(page);
      const forb = scanRendered(await page.evaluate(renderedFacts), `/${name}`); await context.close();
      const got = new Set([...r.problems, ...forb].map((p) => p.check));
      const ok = v.expect.length ? v.expect.every((e) => got.has(e)) : got.size === 0;
      if (ok) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `expected [${v.expect.join(',') || 'clean'}], gate reported [${[...got].join(',') || 'nothing'}] ${[...r.problems, ...forb].map((p) => p.detail).join(' | ').slice(0, 300)}` });
    });
    for (const [name, buggy] of [['reopen-menu', true], ['menu-fixed', false]]) {
      const h = await historyFlow(browser, base, { menuRoute: `/${name}`, searchRoutes: [], videoRoute: null });
      if ((h.length > 0) === buggy) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `history flow reported ${JSON.stringify(h)} (expected ${buggy ? 'a failure' : 'clean'})` });
    }
    for (const [name, buggy] of [['sticky-search', true], ['search-fixed', false]]) {
      const h = await historyFlow(browser, base, { menuRoute: null, searchRoutes: [`/${name}`], videoRoute: null });
      if ((h.length > 0) === buggy) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `history flow reported ${JSON.stringify(h)} (expected ${buggy ? 'a failure' : 'clean'})` });
    }
    for (const [name, buggy] of [['kb-broken', true], ['kb-good', false], ['kb-late', false]]) {
      const k = await keyboardFlow(browser, base, { homeRoute: `/${name}`, searchRoute: null });
      if ((k.length > 0) === buggy) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `keyboard flow reported ${JSON.stringify(k)} (expected ${buggy ? 'a failure' : 'clean'})` });
    }
    for (const [name, buggy] of [['tabs-broken', true], ['tabs-late', false]]) {
      const k = await keyboardFlow(browser, base, { homeRoute: '/kb-good', searchRoute: null, tabsRoute: `/${name}` });
      if ((k.length > 0) === buggy) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `tabs keyboard flow reported ${JSON.stringify(k)} (expected ${buggy ? 'a failure' : 'clean'})` });
    }
    for (const [name, buggy] of [['kb-search-dead', true], ['kb-search-live', false]]) {
      const k = await keyboardFlow(browser, base, { homeRoute: '/kb-good', searchRoute: `/${name}` });
      if ((k.length > 0) === buggy) passed += 1; else problems.push({ check: 'selftest', where: name, detail: `keyboard search reported ${JSON.stringify(k)} (expected ${buggy ? 'a failure' : 'clean'})` });
    }
    const crawl = await linkCrawl(`${base}/dead-link`, { maxPages: 10, externalSample: 0 });
    if (crawl.problems.some((p) => p.detail.includes('/does-not-exist'))) passed += 1; else problems.push({ check: 'selftest', where: 'dead-link', detail: 'crawl did not report /does-not-exist' });
  } finally { server.close(); }
  record('selftest', { passed, failed: problems.length, problems, note: 'broken fixtures must fail, clean must pass' });
}

async function runMatrix(browser, routes, { axe = false } = {}) {
  const jobs = [];
  for (const route of routes) for (const width of (axe ? [1440, 390] : WIDTHS)) jobs.push({ route, width });
  const axeSrc = axe ? axeSource() : null;
  const problems = []; let passed = 0;
  await pool(jobs, CONCURRENCY, async ({ route, width }) => {
    try {
      const r = await checkRoute(browser, BASE + route, width, { axe: axeSrc, expectStatus: route === NOT_FOUND ? [404] : [200], allowConsole: route === NOT_FOUND ? [/status of 404/] : [] });
      let list = axe ? r.problems.filter((p) => p.check === 'axe') : r.problems.filter((p) => p.check !== 'axe');
      if (!axe && (width === 1440 || width === 390)) {
        const context = await newContext(browser, width); const page = await context.newPage();
        await page.goto(BASE + route, { waitUntil: 'load', timeout: 120_000 }); await settle(page);
        list = list.concat(scanRendered(await page.evaluate(renderedFacts), route)); await context.close();
      }
      if (list.length) for (const p of list) problems.push({ ...p, where: `${route} @${width}` }); else passed += 1;
    } catch (e) { problems.push({ check: 'error', where: `${route} @${width}`, detail: String(e.message).slice(0, 200) }); }
  });
  const failedCells = new Set(problems.map((p) => p.where)).size;
  record(axe ? 'a11y' : 'matrix', { passed, failed: failedCells, problems, note: `${jobs.length} route x width cells, ${problems.length} findings` });
}

async function runData(browser) {
  const problems = []; let passed = 0;
  const context = await newContext(browser, 1440); const page = await context.newPage();
  const rowsOf = async (route) => { const res = await page.goto(BASE + route, { waitUntil: 'load', timeout: 120_000 }); await settle(page); return { status: res?.status(), rows: await page.evaluate(tableRows), html: await page.content() }; };
  const check = (name, list) => { if (list.length) problems.push(...list.slice(0, 6).map((d) => ({ check: 'data', where: name, detail: d }))); else passed += 1; };
  try {
    const year = (await jolpica('/current.json')).RaceTable.season;
    const ds = (await jolpicaAny(standingsPaths(year, 'driver'))).StandingsTable.StandingsLists[0];
    check(`/results/${year}/drivers`, compareOrderedRows(expectDriverStandings(ds), (await rowsOf(`/results/${year}/drivers`)).rows, { label: 'P' }));
    const cs = (await jolpicaAny(standingsPaths(year, 'constructor'))).StandingsTable.StandingsLists[0];
    check(`/results/${year}/teams`, compareOrderedRows(expectConstructorStandings(cs), (await rowsOf(`/results/${year}/teams`)).rows, { label: 'P' }));
    const last = (await jolpica('/current/last/results.json')).RaceTable.Races[0];
    check(`last race ${last.raceName}`, compareOrderedRows(expectClassification(last), (await rowsOf(`/schedule/${year}/${last.Circuit.circuitId}-round-${last.round}`)).rows, { label: 'P' }));
    const next = (await jolpica('/current/next.json')).RaceTable.Races[0];
    if (next) {
      const slug = `/schedule/${year}/${next.Circuit.circuitId}-round-${next.round}`;
      const home = await rowsOf('/');
      const sched = await rowsOf('/schedule');
      check(`next race ${next.raceName}`, [home.html.includes(`href="${slug}"`) ? null : `home page has no link to the next race ${slug}`, sched.html.includes(`href="${slug}"`) ? null : `/schedule has no link to the next race ${slug}`].filter(Boolean));
    }
    // Driver current-team logic: every driver who changed team must link to the team of their latest race.
    const races = [];
    for (let offset = 0; ; offset += 100) {
      const page2 = await jolpica(`/${year}/results.json?limit=100&offset=${offset}`);
      races.push(...page2.RaceTable.Races);
      if (offset + 100 >= Number(page2.total)) break;
    }
    const merged = new Map();
    for (const r of races) { const m = merged.get(r.round) ?? { round: r.round, Results: [] }; m.Results.push(...r.Results); merged.set(r.round, m); }
    const { latest, moved } = latestTeams([...merged.values()]);
    for (const id of moved) {
      const team = latest.get(id);
      const { html } = await rowsOf(`/drivers/${id}`);
      check(`/drivers/${id} current team`, html.includes(`href="/teams/${team.constructorId}"`) ? [] : [`raced for ${team.name} in round ${team.round} (latest) but the profile has no link to /teams/${team.constructorId}`]);
      const t = await rowsOf(`/teams/${team.constructorId}`);
      check(`/teams/${team.constructorId} lists ${id}`, t.html.includes(`href="/drivers/${id}"`) ? [] : [`team page does not list ${id}, who raced for it in round ${team.round}`]);
    }
    // Three historical seasons.
    // Three historical seasons: the first three of this list that the source answers for (rate-limit aware).
    let spot = 0;
    for (const s of [1976, 2008, 2018, 1994, 2012, 2021, 1988, 2000, 1965]) {
      if (spot === 3) break;
      let h;
      try { h = (await jolpicaAny(standingsPaths(s, 'driver'))).StandingsTable.StandingsLists[0]; } catch { continue; }
      spot += 1;
      check(`/results/${s}/drivers`, compareOrderedRows(expectDriverStandings(h), (await rowsOf(`/results/${s}/drivers`)).rows, { label: 'P', limit: 10 }));
    }
    if (spot < 3) problems.push({ check: 'error', where: 'history seasons', detail: `only ${spot} historical seasons could be read from Jolpica` });
  } catch (e) { problems.push({ check: 'error', where: 'data', detail: String(e.message).slice(0, 300) }); }
  finally { await context.close(); }
  record('data', { passed, failed: new Set(problems.map((p) => p.where)).size, problems });
}

const started = Date.now();
log(`Apex quality gate  base=${BASE}  checks=${CHECKS.join(',')}  widths=${WIDTHS.join(',')}`);
let browser = null;
try {
  if (CHECKS.includes('static')) await runStatic();
  if (CHECKS.includes('unit')) runUnit();
  const needsBrowser = CHECKS.some((c) => !['static', 'unit', 'links'].includes(c));
  if (needsBrowser) browser = await launchBrowser();
  if (CHECKS.includes('selftest')) await runSelftest(browser);
  let routes = QUICK ? QUICK_ROUTES : STATIC_ROUTES;
  if (!QUICK && CHECKS.some((c) => ['matrix', 'a11y'].includes(c))) {
    try { routes = [...routes, ...(await dynamicRoutes()), NOT_FOUND]; } catch (e) { record('routes', { failed: 1, problems: [{ check: 'error', detail: `could not discover real slugs: ${e.message}` }] }); }
  }
  if (CHECKS.includes('matrix')) await runMatrix(browser, routes);
  if (CHECKS.includes('a11y')) await runMatrix(browser, routes, { axe: true });
  const flow = async (fn) => { try { return await fn(); } catch (e) { return [{ check: 'error', detail: String(e.message).split('\n')[0].slice(0, 200) }]; } };
  // Tabs live on race pages (results sheet): use the last race, read from Jolpica.
  const lastRaceRoute = async () => { const y = (await jolpica('/current.json')).RaceTable.season; const r = (await jolpica('/current/last/results.json')).RaceTable.Races[0]; return `/schedule/${y}/${r.Circuit.circuitId}-round-${r.round}`; };
  if (CHECKS.includes('keyboard')) { const p = await flow(async () => keyboardFlow(browser, BASE, { tabsRoute: await lastRaceRoute() })); record('keyboard', { passed: p.length ? 0 : 1, failed: p.length, problems: p }); }
  if (CHECKS.includes('history')) { const p = await flow(() => historyFlow(browser, BASE)); record('history', { passed: p.length ? 0 : 1, failed: p.length, problems: p }); }
  if (CHECKS.includes('data')) await runData(browser);
  if (CHECKS.includes('links')) { const r = await linkCrawl(BASE); record('links', { passed: r.crawled - r.problems.filter((p) => !p.detail.startsWith('external')).length, failed: r.problems.length, problems: r.problems, note: `${r.crawled} pages crawled, ${r.sampled}/${r.external} external sampled, ${r.blocked.length} bot-blocked (not counted): ${r.blocked.slice(0, 5).join('; ')}` }); }
} finally {
  if (browser) await browser.close();
}
const failed = Object.values(results).reduce((n, r) => n + r.failed, 0);
const dir = path.join(HERE, '.reports'); mkdirSync(dir, { recursive: true });
const file = path.join(dir, `gate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ base: BASE, quick: QUICK, checks: CHECKS, seconds: Math.round((Date.now() - started) / 1000), results }, null, 2));
log(`\n${failed ? 'GATE FAILED' : 'GATE PASSED'}  ${Object.entries(results).map(([k, r]) => `${k} ${r.passed}/${r.passed + r.failed}`).join('  ')}  (${Math.round((Date.now() - started) / 1000)} s)  report: ${path.relative(process.cwd(), file)}`);
process.exitCode = failed ? 1 : 0;
