/**
 * Interaction flows in a real browser: keyboard path, history (Back/Forward)
 * behaviour of overlays and search, and the link crawl. Each returns a list of
 * { check, detail } problems (empty = pass).
 */
import { newContext } from './browser.mjs';

const isOpen = (page) => page.evaluate(() => {
  const btn = document.querySelector('header button[aria-expanded]');
  const dialog = [...document.querySelectorAll('[role="dialog"], dialog[open]')].some((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; });
  return { menu: btn?.getAttribute('aria-expanded') === 'true', dialog };
});

/**
 * Wait for the delivered page: React's streamed Suspense boundaries revealed (no pending
 * `template#B:n` / hidden `div#S:n` left; React 19.2 batches reveals, which can land after
 * 'load') and the network idle. Keyboard checks start from the page a person meets, not the
 * streaming fallback. A boundary that never reveals is not hidden by this: the checks then fail.
 */
export async function delivered(page) {
  await page.waitForFunction(() => !document.querySelector('template[id^="B:"], div[hidden][id^="S:"]'), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

const SEARCH_FIELD = 'input[type="search"]:visible, input[name="q"]:visible, main input[type="text"]:visible';

/** No field: either the page's designed unavailable state (provider outage, so the flow cannot run) or a real missing control. */
async function missingField(page, route, check) {
  const outage = await page.evaluate(() => /\bunavailable\b|can.t be used right now/i.test(document.querySelector('main')?.innerText ?? '')).catch(() => false);
  return outage
    ? { check: 'error', detail: `could not exercise search on ${route}: the page shows its unavailable state (data provider down or over budget); re-run when the provider answers` }
    : { check, detail: `${route} has no search field` };
}

/** Polls (navigation-safe) until the first visible link after the search field names the term. */
async function firstResultNames(page, term, timeout = 5_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const ok = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const field = [...document.querySelectorAll('input[type="search"], input[name="q"], main input[type="text"]')].find((f) => f.offsetParent !== null);
      if (!field || !re.test(field.value)) return false;
      const after = [...document.querySelectorAll('main a[href]')].filter((a) => (field.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && a.offsetParent !== null && a.innerText.trim());
      return after.length > 0 && re.test(after[0].innerText);
    }, term.source).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Keyboard: Tab reaches the header, the menu opens with Enter, traps focus, closes with Escape and returns focus; search and tabs work by keyboard. */
export async function keyboardFlow(browser, base, { homeRoute = '/', searchRoute = '/search', tabsRoute = null } = {}) {
  const problems = [];
  const context = await newContext(browser, 390);
  const page = await context.newPage();
  try {
    await page.goto(base + homeRoute, { waitUntil: 'load', timeout: 120_000 });
    await delivered(page);
    let reachedMenu = false;
    for (let i = 0; i < 25 && !reachedMenu; i += 1) {
      await page.keyboard.press('Tab');
      reachedMenu = await page.evaluate(() => document.activeElement?.matches('header button[aria-expanded]') ?? false);
    }
    if (!reachedMenu) problems.push({ check: 'keyboard', detail: 'menu button not reachable with Tab within 25 presses (390px)' });
    else {
      const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 || s.boxShadow !== 'none'; });
      if (!ring) problems.push({ check: 'keyboard', detail: 'focused menu button shows no focus indicator' });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('header button[aria-expanded]')?.getAttribute('aria-expanded') === 'true', null, { timeout: 3_000 }).catch(() => {});
      if (!(await isOpen(page)).menu) problems.push({ check: 'keyboard', detail: 'Enter on the menu button does not open the menu' });
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], dialog[open], header')));
      if (!inside) problems.push({ check: 'keyboard', detail: 'focus escapes the open menu after 40 Tabs (no focus trap)' });
      await page.keyboard.press('Escape');
      // Bounded condition waits (the close animation runs first), not fixed sleeps.
      await page.waitForFunction(() => document.querySelector('header button[aria-expanded]')?.getAttribute('aria-expanded') === 'false', null, { timeout: 3_000 }).catch(() => {});
      if ((await isOpen(page)).menu) problems.push({ check: 'keyboard', detail: 'Escape does not close the menu within 3 s' });
      const back = await page.waitForFunction(() => document.activeElement?.matches('header button[aria-expanded]') ?? false, null, { timeout: 3_000 }).then(() => true, () => false);
      if (!back) problems.push({ check: 'keyboard', detail: 'focus does not return to the menu button within 3 s of Escape' });
    }
    // Search by keyboard: the Search control leads to a usable search field.
    if (searchRoute) {
      await page.goto(base + searchRoute, { waitUntil: 'load', timeout: 120_000 });
      // Delivered and hydrated before typing (a busy dev server can take seconds), bounded.
      await delivered(page);
    }
    const field = page.locator(SEARCH_FIELD).first();
    if (searchRoute) await field.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (!searchRoute) { /* search part not requested */ } else if (!(await field.count())) problems.push(await missingField(page, searchRoute, 'keyboard'));
    else {
      await field.focus();
      await page.keyboard.type('Leclerc');
      await page.keyboard.press('Enter');
      // The first result after the field must name Leclerc. "Leclerc appears somewhere in main" also passes a
      // field that does nothing on a page whose default list already includes him (as /search's 2026 grid does).
      if (!(await firstResultNames(page, /leclerc/i))) problems.push({ check: 'keyboard', detail: `typing "Leclerc" + Enter in ${searchRoute}: the first result after the field does not name Leclerc within 5 s` });
    }
    if (tabsRoute) problems.push(...(await tabsKeyboard(page, base + tabsRoute, tabsRoute)));
  } finally {
    await context.close();
  }
  return problems;
}

/**
 * Wait until the page can answer a key press: network quiet, then (on a React
 * page) the element carries React's props, i.e. hydration reached it. Bounded;
 * pages without React (the self-test fixtures) only wait for the network.
 */
export async function waitHydrated(page, selector, timeout = 20_000) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const react = Boolean(window.__next_f || document.querySelector('[data-reactroot]'));
    return !react || Object.keys(el).some((k) => k.startsWith('__reactProps'));
  }, selector, { timeout }).catch(() => {});
}

/**
 * Tabs by keyboard (WAI-ARIA): once the page is hydrated, ArrowRight on the
 * selected tab must move focus to the NEXT tab in the same tablist and select
 * it. Waits for the condition (bounded), never a fixed sleep, and a press that
 * does nothing fails (focus left on the first tab is not a pass).
 */
export async function tabsKeyboard(page, url, label = url) {
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  const SEL = '[role="tablist"] [role="tab"][aria-selected="true"]';
  await waitHydrated(page, SEL);
  const tab = page.locator(SEL).first();
  if (!(await tab.count())) return [{ check: 'error', detail: `could not exercise: no selected [role=tab] in a tablist on ${label}` }];
  const count = await tab.evaluate((t) => t.closest('[role="tablist"]').querySelectorAll('[role="tab"]').length);
  if (count < 2) return [{ check: 'error', detail: `could not exercise: only one tab on ${label}` }];
  await tab.focus();
  await tab.evaluate((t) => { window.__qaTab = { list: t.closest('[role="tablist"]'), from: t }; });
  await page.keyboard.press('ArrowRight');
  const ok = await page.waitForFunction(() => {
    const { list, from } = window.__qaTab;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const want = tabs[(tabs.indexOf(from) + 1) % tabs.length];
    const a = document.activeElement;
    return a === want && a.getAttribute('aria-selected') === 'true' && from.getAttribute('aria-selected') === 'false';
  }, null, { timeout: 3_000 }).then(() => true, () => false);
  if (ok) return [];
  const got = await page.evaluate(() => { const a = document.activeElement; return `focus on ${a?.getAttribute('role') === 'tab' ? `tab "${a.textContent.trim().slice(0, 30)}" (selected=${a.getAttribute('aria-selected')})` : a?.tagName.toLowerCase()}`; });
  return [{ check: 'keyboard', detail: `${label}: ArrowRight does not move to and select the next tab (${got} after 3 s)` }];
}

/** Back/Forward must never reopen the menu, the search overlay or a video, and a cleared search must stay cleared. */
export async function historyFlow(browser, base, { menuRoute = '/', searchRoutes = ['/drivers/all', '/teams/all', '/search'], videoRoute = '/video' } = {}) {
  const problems = [];
  const context = await newContext(browser, 390);
  const page = await context.newPage();
  try {
    // Anything the flow cannot exercise is a failure, never a silent pass.
    const cannot = (what) => problems.push({ check: 'error', detail: `could not exercise: ${what}` });
    const step = async (name, fn) => { try { await fn(); } catch (e) { problems.push({ check: 'error', detail: `${name}: ${String(e.message).split('\n').filter((l) => !/^\s*-? ?(waiting|retrying)/.test(l)).slice(0, 4).join(' / ').slice(0, 300)}` }); } };
    // Menu: open it, follow a link inside it, then Back and Forward.
    await step('menu Back/Forward', async () => {
    const btn = page.locator('header button[aria-expanded]').first();
    if (menuRoute) await page.goto(base + menuRoute, { waitUntil: 'load', timeout: 120_000 });
    if (menuRoute && !(await btn.count())) cannot(`menu button on ${menuRoute}`);
    if (menuRoute && (await btn.count())) {
      await btn.click();
      await page.waitForTimeout(400);
      const link = page.locator('dialog[open] a[href^="/"]:not([href="/"]):visible, [role="dialog"] a[href^="/"]:not([href="/"]):visible, #site-menu a[href^="/"]:not([href="/"]):visible').first();
      if (!(await link.count())) cannot('a link inside the open menu');
      else {
        await Promise.all([page.waitForURL((u) => u.pathname !== menuRoute, { timeout: 60_000 }), link.click()]);
        await page.waitForLoadState('load');
        await page.goBack({ waitUntil: 'load' });
        await page.waitForTimeout(800);
        if ((await isOpen(page)).menu) problems.push({ check: 'history', detail: 'menu reopens after Back' });
        await page.goForward({ waitUntil: 'load' });
        await page.waitForTimeout(800);
        if ((await isOpen(page)).menu) problems.push({ check: 'history', detail: 'menu reopens after Forward' });
        await page.goto(base + menuRoute, { waitUntil: 'load' });
        await page.waitForTimeout(800);
        if ((await isOpen(page)).menu) problems.push({ check: 'history', detail: 'menu open on a later visit to the same page' });
      }
    }
    });
    // Cleared search must not come back after Back.
    for (const route of searchRoutes) await step(`cleared search on ${route}`, async () => {
      await page.goto(base + route, { waitUntil: 'load', timeout: 120_000 });
      await delivered(page);
      const field = page.locator(SEARCH_FIELD).first();
      await field.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
      if (!(await field.count())) { const m = await missingField(page, route, 'history'); if (m.check === 'error') problems.push(m); else cannot(`search field on ${route}`); return; }
      await field.fill('Ham');
      await page.waitForTimeout(700);
      await field.fill('');
      await page.waitForTimeout(700);
      const next = page.locator('header a[href="/support"]:visible').first();
      await Promise.all([page.waitForURL(/\/support/, { timeout: 60_000 }), next.click()]);
      await page.goBack({ waitUntil: 'load' });
      await page.waitForTimeout(1000);
      const value = await page.locator('input[type="search"]:visible, input[name="q"]:visible, main input[type="text"]:visible').first().inputValue().catch(() => '');
      if (value) problems.push({ check: 'history', detail: `${route}: cleared search returns as "${value}" after Back` });
    });
    // Video overlay: open, close, then Back/Forward must not reopen it or strand the reader.
    if (videoRoute) await step('video overlay', async () => {
      await page.goto(base + videoRoute, { waitUntil: 'load', timeout: 120_000 });
      const card = page.locator('main a[data-apex-video-id]:visible, main button[aria-haspopup="dialog"]:visible').first();
      if (!(await card.count())) cannot(`a video card on ${videoRoute}`);
      else {
        await card.click();
        await page.waitForFunction(() => Boolean(document.querySelector('dialog[open], [role="dialog"]')), null, { timeout: 5_000 }).catch(() => {});
        if (!(await isOpen(page)).dialog) cannot('opening a video overlay');
        else {
          // The visible close control, not a full-screen backdrop button (tabindex -1) that the panel covers.
          const close = page.locator('[role="dialog"] button[aria-label*="lose" i]:not([tabindex="-1"]):visible, dialog[open] button[aria-label*="lose" i]:not([tabindex="-1"]):visible').first();
          if (await close.count()) await close.click(); else await page.keyboard.press('Escape');
          await page.waitForTimeout(600);
          const urlAfterClose = page.url();
          await page.goForward().catch(() => {});
          await page.waitForTimeout(800);
          if ((await isOpen(page)).dialog) problems.push({ check: 'history', detail: 'video overlay reopens on Forward after closing it' });
          if (page.url() !== urlAfterClose && !(await isOpen(page)).dialog) problems.push({ check: 'history', detail: `Forward after closing a video lands on a dead history entry (${page.url()})` });
          await page.goBack().catch(() => {});
          await page.waitForTimeout(800);
          if ((await isOpen(page)).dialog) problems.push({ check: 'history', detail: 'video overlay reopens on Back' });
        }
      }
    });
  } finally {
    await context.close();
  }
  return problems;
}

/**
 * One external link: HEAD, then GET when HEAD is refused or the connection
 * failed. A connection that fails (status 0: reset, timeout) is tried once more
 * after a pause, so a third-party host resetting one bot request (Wikimedia
 * ECONNRESET) is not reported as a dead link; a link that fails twice still is,
 * and any HTTP error status is final.
 */
export async function checkExternal(url, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = 2_000 } = {}) {
  const get = (method) => fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15_000) }).catch((e) => ({ status: 0, error: e }));
  let res = await get('HEAD');
  if (res.status === 405 || res.status === 404 || res.status === 0) res = await get('GET');
  if (res.status === 0) { await sleep(pauseMs); res = await get('GET'); }
  return res;
}

/** Internal crawl (bounded, gentle) and external HEAD sampling. */
export async function linkCrawl(base, { maxPages = 120, externalSample = 30, concurrency = 3 } = {}) {
  const problems = [];
  const origin = new URL(base).origin;
  const start = new URL(base).pathname || '/';
  const seen = new Set([start]);
  const queue = [start];
  const external = new Set();
  let crawled = 0;
  async function visit(path) {
    const res = await fetch(origin + path, { redirect: 'follow', headers: { 'user-agent': 'ApexQualityGate/1.0' } }).catch((e) => ({ status: 0, error: e }));
    crawled += 1;
    if (!res.status || res.status >= 400) { problems.push({ check: 'links', detail: `${path}: HTTP ${res.status || res.error?.message}` }); return; }
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return;
    const html = await res.text();
    for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"#]+)"/g)) {
      const href = m[1].replace(/&amp;/g, '&');
      if (href.startsWith('/') && !href.startsWith('//')) {
        const clean = href.split('#')[0];
        if (/^\/(api|_next|admin)\b/.test(clean)) continue;
        if (!seen.has(clean) && seen.size < maxPages) { seen.add(clean); queue.push(clean); }
      } else if (/^https?:\/\//.test(href) && !href.startsWith(origin)) external.add(href);
    }
  }
  while (queue.length) await Promise.all(queue.splice(0, concurrency).map(visit));
  // External links: deterministic sample spread across the set; 401/403/429/999 mean "blocked for bots", not dead.
  const all = [...external].sort();
  const step = Math.max(1, Math.floor(all.length / externalSample));
  const sample = all.filter((_, i) => i % step === 0).slice(0, externalSample);
  const blocked = [];
  for (const url of sample) {
    const res = await checkExternal(url);
    if ([401, 403, 429, 999].includes(res.status)) blocked.push(`${res.status} ${url}`);
    else if (!res.status || res.status >= 400) problems.push({ check: 'links', detail: `external ${url}: ${res.status || res.error?.cause?.code || res.error?.message}` });
  }
  return { problems, crawled, external: all.length, sampled: sample.length, blocked };
}
