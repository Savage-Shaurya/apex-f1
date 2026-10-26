/**
 * Cross-page layout integrity (design direction §8 "Wiring", §4.3): every
 * route group, at 1440, 768, 390 and 320 px, in a real browser.
 *
 * Fails on:
 *   - any visible text under 24px with negative computed letter-spacing;
 *   - clipped text (own box or an ancestor's overflow) and words broken
 *     across lines;
 *   - horizontal page overflow.
 * With APEX_BROWSER_STRICT=1 it also fails on broken or hard-cropped images,
 * console errors and serious/critical axe-core issues.
 *
 * It needs a running server, so it is skipped unless APEX_BROWSER_BASE_URL is
 * set (the root `pnpm test` stays hermetic):
 *
 *   APEX_BROWSER_BASE_URL=http://localhost:3000 \
 *   node --test apps/web/tests/browser/layout-integrity.test.mjs
 *
 * Options: APEX_BROWSER_WIDTHS=1440,390   APEX_BROWSER_ROUTES=/,/latest (substring match)
 *          APEX_PLAYWRIGHT_DIR=<dir containing node_modules/playwright>   APEX_AXE_PATH=<axe.min.js>
 * Playwright is resolved from this repo or APEX_PLAYWRIGHT_DIR; it uses the
 * installed Chrome (channel "chrome").
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { auditRoute, problemsOf } from './layout-audit.mjs';

const BASE = process.env.APEX_BROWSER_BASE_URL?.replace(/\/$/, '');
const WIDTHS = (process.env.APEX_BROWSER_WIDTHS ?? '1440,768,390,320').split(',').map(Number).filter((n) => n >= 280);
const ONLY = process.env.APEX_BROWSER_ROUTES?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const STRICT = process.env.APEX_BROWSER_STRICT === '1';

/** Fixed routes, one or more per route group. Dynamic routes are discovered from real links. */
const STATIC_ROUTES = [
  '/', '/latest', '/video', '/search?q=Antonelli', '/newsletter',
  '/schedule', '/results/archive',
  '/drivers', '/drivers/champions', '/drivers/all',
  '/teams', '/teams/champions', '/teams/all',
  '/live/timing', '/live/track', '/live/race-control',
  '/predict', '/about', '/contact', '/legal/privacy', '/legal/terms', '/legal/disclaimer', '/legal/dmca', '/support',
  // Design-system preview: dev only (a production server answers with the 404 page, which is checked too).
  '/design',
];
const NOT_FOUND_ROUTE = '/this-page-is-not-on-the-timing-sheet';

async function loadPlaywright() {
  const attempts = [() => import('playwright')];
  if (process.env.APEX_PLAYWRIGHT_DIR) {
    const req = createRequire(path.join(process.env.APEX_PLAYWRIGHT_DIR, 'package.json'));
    attempts.unshift(() => import(pathToFileURL(req.resolve('playwright')).href));
  }
  for (const attempt of attempts) {
    try {
      const mod = await attempt();
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return { chromium };
    } catch { /* try the next location */ }
  }
  return null;
}

function loadAxe() {
  try {
    const file = process.env.APEX_AXE_PATH ?? createRequire(import.meta.url).resolve('axe-core/axe.min.js');
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Real links from the live site, so the test never hard-codes a season, driver or race. */
async function discoverRoutes(browser) {
  const page = await browser.newPage();
  const found = [];
  const firstHref = async (url, pattern) => {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const hrefs = await page.$$eval('a[href^="/"]', (links) => links.map((a) => a.getAttribute('href')));
    return hrefs.find((h) => h && pattern.test(h)) ?? null;
  };
  const results = await firstHref('/', /^\/results\/\d{4}\/drivers$/);
  if (results) found.push(results, results.replace(/drivers$/, 'teams'));
  const race = await firstHref('/schedule', /^\/schedule\/\d{4}\/[\w-]+$/);
  if (race) found.push(race);
  const driver = await firstHref('/drivers', /^\/drivers\/(?!champions|all|hall-of-fame)[\w-]+$/);
  if (driver) found.push(driver, `${driver}/career`);
  const team = await firstHref('/teams', /^\/teams\/(?!champions|all)[\w-]+$/);
  if (team) found.push(team, `${team}/history`);
  await page.close();
  return found;
}

test('every route group renders without negative tracking, clipped text or sideways scroll', { skip: BASE ? false : 'set APEX_BROWSER_BASE_URL to run the browser layout test' }, async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright) {
    t.skip('Playwright is not installed here; set APEX_PLAYWRIGHT_DIR to a folder with node_modules/playwright');
    return;
  }
  const axeSource = STRICT ? loadAxe() : null;
  if (STRICT && !axeSource) t.diagnostic('axe-core not found: accessibility checks skipped (set APEX_AXE_PATH)');
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const routes = [...STATIC_ROUTES, ...(await discoverRoutes(browser)), NOT_FOUND_ROUTE]
      .filter((route) => !ONLY || ONLY.some((needle) => route.includes(needle)));
    assert.ok(routes.length > 0, 'at least one route to check');
    for (const route of routes) {
      for (const width of WIDTHS) {
        await t.test(`${route} @ ${width}px`, async () => {
          const result = await auditRoute(browser, BASE + route, width, { axeSource });
          try {
            const expected = route === NOT_FOUND_ROUTE ? [404] : [200];
            // The 404 document itself is logged by the browser as a failed resource; that is the expected status, not an error.
            const all = problemsOf(result, { allowStatus: expected }).filter((p) => !(route === NOT_FOUND_ROUTE && /status of 404/.test(p)));
            const layout = all.filter((p) => /^(HTTP|horizontal overflow|negative tracking|clipped text|word broken)/.test(p));
            const problems = STRICT ? all : layout;
            assert.deepEqual(problems, [], `${route} at ${width}px:\n  - ${problems.join('\n  - ')}`);
          } finally {
            await result.context.close();
          }
        });
      }
    }
  } finally {
    await browser.close();
  }
});
