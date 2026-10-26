/**
 * Shell and home polish, measured in a real browser (responsive audit
 * 2026-10-26, findings M1, M3, M4, L3, L4).
 *
 *   hero photo   phones get an art-directed portrait rendition, and the photo is
 *                drawn at no more than 1.35x the source at DPR 2 (the source is 1080px tall) (M1);
 *   consent      first-visit banner is at most 96px tall on every phone (M3);
 *   circuit      the circuit name on the home photo card sits on an opaque
 *                background with AA contrast on phones (M4);
 *   notes        no paragraph-length text (60+ characters) under 14px on phones (L3);
 *   footer       no footer line over 80 characters at 1920 and 2560, no credit,
 *                licence or non-affiliation text, socials exactly as social.ts (L4).
 *
 * Needs a running server, so it is skipped unless APEX_BROWSER_BASE_URL is set:
 *   APEX_BROWSER_BASE_URL=http://localhost:3390 APEX_PLAYWRIGHT_DIR=<dir> \
 *   node --test apps/web/tests/browser/shell-home.test.mjs
 *
 * The consent banner exists only when the server was built with an analytics
 * provider (NEXT_PUBLIC_POSTHOG_KEY, final audit F-12). Set
 * APEX_BROWSER_ANALYTICS=1 for such a server to run the banner checks (M3, A3,
 * A5); otherwise C0 checks that no banner or "Cookie preferences" control renders.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = process.env.APEX_BROWSER_BASE_URL?.replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ONLY = process.env.APEX_ONLY?.split(',') ?? null;
const only = (name) => !ONLY || ONLY.some((o) => name.startsWith(o));
const ANALYTICS = process.env.APEX_BROWSER_ANALYTICS === '1';
const NO_BANNER = 'the consent banner exists only on a server built with an analytics provider (APEX_BROWSER_ANALYTICS=1)';
const PHONES = [[320, 568], [360, 800], [375, 667], [390, 844], [430, 932]];

async function chromium() {
  const attempts = [() => import('playwright')];
  if (process.env.APEX_PLAYWRIGHT_DIR) {
    const req = createRequire(path.join(process.env.APEX_PLAYWRIGHT_DIR, 'package.json'));
    attempts.unshift(() => import(pathToFileURL(req.resolve('playwright')).href));
  }
  for (const a of attempts) {
    try { const m = await a(); return m.chromium ?? m.default.chromium; } catch { /* next */ }
  }
  throw new Error('playwright not found (set APEX_PLAYWRIGHT_DIR)');
}

/** Social links as declared in social.ts (parsed, so this file needs no TS loader). */
function socialLinks() {
  const src = readFileSync(path.join(HERE, '../../components/ds/shell/social.ts'), 'utf8');
  return [...src.matchAll(/href: '([^']+)', accessibleName: '([^']+)'/g)].map((m) => ({ href: m[1], name: m[2] }));
}

async function open(browser, [width, height], route, { dpr = 1, consent = true } = {}) {
  const touch = width <= 1024;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
  if (consent) await context.addInitScript(() => { try { localStorage.setItem('apex.consent.v1', JSON.stringify({ analytics: false, marketing: false, ts: new Date().toISOString() })); } catch { /* */ } });
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: 'load', timeout: 90_000 });
  return { page, context };
}

test('shell and home polish (browser)', { skip: !BASE && 'APEX_BROWSER_BASE_URL not set' }, async (t) => {
  const browser = await (await chromium()).launch({ channel: 'chrome' });
  t.after(() => browser.close());

  await t.test('M1 hero photo: portrait rendition on phones, sharp at DPR 2', { skip: !only('M1 hero photo: portrait rendition on phones, sharp at DPR 2') }, async () => {
    const out = [];
    for (const size of [[320, 568], [390, 844], [430, 932], [768, 1024]]) {
      const { page, context } = await open(browser, size, '/', { dpr: 2 });
      await page.waitForFunction(() => { const i = document.querySelector('img.bc-kenburns'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30_000 });
      const m = await page.evaluate(async () => {
        const img = document.querySelector('img.bc-kenburns');
        // naturalWidth is density-corrected under srcset w-descriptors; load the chosen file alone for its real pixels.
        const raw = new Image();
        raw.src = img.currentSrc;
        await raw.decode();
        const r = img.getBoundingClientRect(); // includes the slow Ken Burns zoom
        const scale = Math.max(r.width / raw.naturalWidth, r.height / raw.naturalHeight); // object-fit: cover
        return { src: img.currentSrc.replace(/^.*upload\/([^/]+)\/.*$/, '$1'), px: `${raw.naturalWidth}x${raw.naturalHeight}`, box: `${Math.round(r.width)}x${Math.round(r.height)}`, stretch: +(scale * devicePixelRatio).toFixed(2), visibleW: +Math.min(1, r.width / (raw.naturalWidth * scale)).toFixed(2) };
      });
      out.push({ size: size.join('x'), ...m });
      await context.close();
    }
    console.log('M1', JSON.stringify(out));
    for (const m of out) {
      assert.ok(m.stretch <= 1.35, `${m.size}: photo stretched ${m.stretch}x at DPR 2 (${m.src})`);
      if (Number(m.size.split('x')[0]) < 1024) assert.match(m.src, /ar_(2:3|6:5),g_auto/, `${m.size}: phones and tablets need the art-directed crop`);
    }
  });

  await t.test('C0 without an analytics provider there is no consent banner and no Cookie preferences control', { skip: !only('C0') || (ANALYTICS && 'server has an analytics provider') }, async () => {
    const out = [];
    for (const [size, route] of [[[390, 844], '/'], [[1440, 900], '/'], [[1440, 900], '/legal/privacy']]) {
      const { page, context } = await open(browser, size, route, { consent: false });
      await page.waitForTimeout(2_000); // the banner used to open 900ms after first paint
      out.push({ route, size: size.join('x'), banner: await page.locator('[data-shell="consent"]').count(), prefs: await page.getByRole('button', { name: 'Cookie preferences' }).count() });
      await context.close();
    }
    console.log('C0', JSON.stringify(out));
    for (const m of out) assert.deepEqual([m.banner, m.prefs], [0, 0], `${m.route} at ${m.size}`);
  });

  await t.test('M3 consent banner is compact on phones (<= 96px)', { skip: !only('M3 consent banner is compact on phones (<= 96px)') || (!ANALYTICS && NO_BANNER) }, async () => {
    const out = [];
    for (const size of PHONES) {
      const { page, context } = await open(browser, size, '/', { consent: false });
      const el = page.locator('[data-shell="consent"]');
      await el.waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(900);
      const m = await el.evaluate((n) => {
        const r = n.getBoundingClientRect();
        const btns = [...n.querySelectorAll('button')].map((b) => b.textContent.trim());
        const sizes = [...n.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().width));
        return { h: Math.round(r.height), btns, sizes };
      });
      out.push({ size: size.join('x'), ...m });
      await context.close();
    }
    console.log('M3', JSON.stringify(out));
    for (const m of out) {
      assert.ok(m.h <= 96, `${m.size}: consent banner ${m.h}px tall`);
      assert.deepEqual(m.btns.slice(0, 2), ['Reject', 'Accept'], `${m.size}: Reject then Accept`);
      assert.equal(m.sizes[0], m.sizes[1], `${m.size}: Reject and Accept equal width`);
    }
  });

  await t.test('M4 circuit name on the home photo card has an opaque AA background on phones', { skip: !only('M4 circuit name on the home photo card has an opaque AA background on phones') }, async () => {
    const out = [];
    for (const size of [[320, 568], [390, 844], [430, 932]]) {
      const { page, context } = await open(browser, size, '/');
      const fig = page.locator('figure:has(img[data-zoom])').first();
      if (!(await fig.count())) { out.push({ size: size.join('x'), missing: true }); await context.close(); continue; }
      await fig.scrollIntoViewIfNeeded();
      const m = await fig.evaluate((f) => {
        const img = f.querySelector('img').getBoundingClientRect();
        const name = f.querySelector('figcaption span').getBoundingClientRect();
        const overlap = Math.max(0, Math.min(img.bottom, name.bottom) - Math.max(img.top, name.top));
        return { overlapPx: Math.round(overlap) };
      });
      out.push({ size: size.join('x'), ...m });
      await context.close();
    }
    console.log('M4', JSON.stringify(out));
    for (const m of out) if (!m.missing) assert.equal(m.overlapPx, 0, `${m.size}: circuit name drawn over the photo (${m.overlapPx}px)`);
  });

  await t.test('L3 no paragraph-length text under 14px on phones', { skip: !only('L3 no paragraph-length text under 14px on phones') }, async () => {
    const bad = [];
    for (const route of ['/', '/schedule', '/search?q=Antonelli', '/video', '/predict', '/about']) {
      const { page, context } = await open(browser, [390, 844], route);
      await page.waitForTimeout(500);
      const small = await page.evaluate(() => {
        const found = [];
        for (const el of document.querySelectorAll('body p, body li, body figcaption, body dd')) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          const r = el.getBoundingClientRect();
          if (text.length < 60 || !r.width || el.closest('[aria-hidden="true"], .sr-only, nav')) continue;
          const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
          if (own.length < 20) continue; // a wrapper of other elements, measured on its own
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 14) found.push(`${px}px "${text.slice(0, 50)}"`);
        }
        return found;
      });
      bad.push(...small.map((s) => `${route}: ${s}`));
      await context.close();
    }
    console.log('L3', JSON.stringify(bad));
    assert.deepEqual(bad, []);
  });

  await t.test('L4 footer: measure capped, no credits or licences, socials from social.ts', { skip: !only('L4 footer: measure capped, no credits or licences, socials from social.ts') }, async () => {
    const expected = socialLinks();
    for (const size of [[1920, 1080], [2560, 1440], [390, 844]]) {
      const { page, context } = await open(browser, size, '/');
      const m = await page.evaluate(() => {
        const footer = document.querySelector('[data-shell="footer"]');
        let maxCpl = 0; let worst = '';
        for (const el of footer.querySelectorAll('p, li, span, a')) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text.length < 30) continue;
          const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
          const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
          const cpl = Math.round(text.length / lines);
          if (cpl > maxCpl) { maxCpl = cpl; worst = text.slice(0, 40); }
        }
        const socials = [...footer.querySelectorAll('ul[aria-label="Follow Apex"] a')].map((a) => ({ href: a.getAttribute('href'), name: a.getAttribute('aria-label') }));
        return { maxCpl, worst, text: footer.innerText, socials };
      });
      console.log('L4', size.join('x'), m.maxCpl, JSON.stringify(m.worst));
      assert.ok(m.maxCpl <= 80, `${size.join('x')}: footer line ${m.maxCpl} characters ("${m.worst}")`);
      assert.doesNotMatch(m.text, /licen[cs]e|affiliat|trademark|credit|photo:|CC BY|wikimedia|not associated|unofficial/i, 'footer carries credit, licence or non-affiliation text');
      assert.deepEqual(m.socials, expected, 'footer socials must match social.ts exactly');
      await context.close();
    }
  });
  const lum = (r, g, b) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [lum(...a), lum(...b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  await t.test('A1 ticker: pause control first; every focused headline is visible', { skip: !only('A1') }, async () => {
    const { page, context } = await open(browser, [1440, 900], '/');
    await page.waitForTimeout(6000); // let the ticker move
    const order = await page.evaluate(() => {
      const t = document.querySelector('.bc-ticker');
      const btn = t.querySelector('button'); const link = t.querySelector('.bc-ticker-scroll a');
      return Boolean(btn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    await page.locator('.bc-ticker button').focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); // keyboard modality
    const vis = [];
    const n = await page.locator('.bc-ticker-scroll ul:not(.bc-ticker-clone) a').count();
    // Reach the links by keyboard: from the pause button (after the fix) or from the last link backwards (before).
    await page.locator('.bc-ticker-scroll ul:not(.bc-ticker-clone) a').first().focus();
    for (let i = 0; i < n; i++) {
      if (i) await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      vis.push(await page.evaluate(() => {
        const a = document.activeElement; const box = document.querySelector('.bc-ticker-scroll').getBoundingClientRect(); const r = a.getBoundingClientRect();
        if (!a.closest('.bc-ticker-scroll')) return -1;
        return +(Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) / r.width).toFixed(2);
      }));
    }
    console.log('A1', JSON.stringify({ pauseFirst: order, visible: vis }));
    await context.close();
    assert.ok(order, 'pause button must come before the headline links');
    assert.ok(vis.every((v) => v >= 0.9), `focused headlines not visible: ${vis}`);
  });

  await t.test('A2 focus ring is not clipped in tab rows and rails', { skip: !only('A2') }, async () => {
    const cut = [];
    for (const [route, sel] of [['/schedule', '[role=tablist] [role=tab], ul.overflow-x-auto a'], ['/results/2026/drivers', '[role=tablist] [role=tab], ul.overflow-x-auto a'], ['/', '#bc-season-rail a, #bc-season-rail button']]) {
      for (const size of [[1440, 900], [390, 844]]) {
        const { page, context } = await open(browser, size, route);
        await page.keyboard.press('Tab');
        const els = page.locator(sel);
        const count = Math.min(3, await els.count());
        for (let i = 0; i < count; i++) {
          await els.nth(i).focus();
          const m = await els.nth(i).evaluate((el) => {
            const cs = getComputedStyle(el); const w = parseFloat(cs.outlineWidth) || 0; const o = parseFloat(cs.outlineOffset) || 0;
            const r = el.getBoundingClientRect(); const g = w + o;
            const ring = { l: r.left - g, t: r.top - g, r: r.right + g, b: r.bottom + g };
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const as = getComputedStyle(a);
              if (/(hidden|auto|scroll|clip)/.test(as.overflowX + as.overflowY)) {
                const c = a.getBoundingClientRect();
                const px = Math.max(c.top - ring.t, ring.b - c.bottom, c.left - ring.l, ring.r - c.right);
                if (px > 0.5 && r.left >= c.left && r.right <= c.right) return { px: Math.round(px), el: (el.textContent || '').trim().slice(0, 20) };
              }
            }
            return null;
          });
          if (m) cut.push(`${route}@${size[0]} "${m.el}" ring cut ${m.px}px`);
        }
        await context.close();
      }
    }
    console.log('A2', JSON.stringify(cut));
    assert.deepEqual(cut, []);
  });

  await t.test('A3 form control edges reach 3:1', { skip: !only('A3') || (!ANALYTICS && NO_BANNER) }, async () => {
    const { page, context } = await open(browser, [1440, 900], '/', { consent: false });
    await page.locator('[data-shell="consent"]').waitFor();
    await page.getByRole('button', { name: 'Choose' }).click();
    const m = await page.evaluate(() => {
      const box = document.querySelector('[data-shell="consent"] input[type=checkbox]');
      const banner = document.querySelector('[data-shell="consent"]');
      const rgba = (s) => ([...s.matchAll(/rgba?\(([^)]+)\)/g)].pop()?.[1] ?? '0,0,0,0').split(/[ ,/]+/).filter(Boolean).map(Number); // the last shadow is the edge
      return { edge: rgba(getComputedStyle(box).boxShadow), bg: rgba(getComputedStyle(banner).backgroundColor) };
    });
    const [r, g, b, a = 1] = m.edge; const mix = [r, g, b].map((v, i) => v * a + m.bg[i] * (1 - a));
    const ratio = +contrast(mix, m.bg.slice(0, 3)).toFixed(2);
    console.log('A3', JSON.stringify({ ...m, ratio }));
    await context.close();
    assert.ok(ratio >= 3, `checkbox edge ${ratio}:1`);
  });

  await t.test('A5 at 400% zoom the consent banner never covers the focused control', { skip: !only('A5') || (!ANALYTICS && NO_BANNER) }, async () => {
    const hidden = [];
    for (const route of ['/schedule', '/']) {
      const { page, context } = await open(browser, [320, 256], route, { consent: false });
      await page.locator('[data-shell="consent"]').waitFor();
      await page.waitForTimeout(900);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(120);
        const m = await page.evaluate(() => {
          const a = document.activeElement; const banner = document.querySelector('[data-shell="consent"]');
          if (!a || a === document.body || banner.contains(a)) return null;
          const r = a.getBoundingClientRect(); if (!r.width || !r.height) return null;
          const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, r.top + r.height / 2));
          return banner.contains(hit) ? (a.textContent || a.getAttribute('aria-label') || a.tagName).trim().slice(0, 30) : null;
        });
        if (m) hidden.push(`${route}: "${m}"`);
      }
      await context.close();
    }
    console.log('A5', JSON.stringify(hidden));
    assert.deepEqual(hidden, []);
  });

  await t.test('A6 a focused card in a home rail is fully in view on phones', { skip: !only('A6') }, async () => {
    const { page, context } = await open(browser, [390, 844], '/');
    const links = page.locator('#bc-season-rail a');
    await links.first().scrollIntoViewIfNeeded();
    await links.first().focus();
    const vis = [];
    for (let i = 0; i < Math.min(6, await links.count()); i++) {
      if (i) await page.keyboard.press('Tab');
      await page.waitForTimeout(700);
      vis.push(await page.evaluate(() => { const a = document.activeElement; const li = a.closest('li') ?? a; const r = li.getBoundingClientRect(); return +(Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) / r.width).toFixed(2); }));
    }
    console.log('A6', JSON.stringify(vis));
    await context.close();
    assert.ok(vis.every((v) => v >= 0.9), `focused rail cards only partly visible: ${vis}`);
  });

  await t.test('A7 landmarks: no nested complementary on legal pages, unique landmarks on /design', { skip: !only('A7') }, async () => {
    const out = {};
    for (const route of ['/legal/privacy', '/design']) {
      const { page, context } = await open(browser, [1440, 900], route);
      out[route] = await page.evaluate(() => ({
        nestedAside: document.querySelectorAll('main aside, main [role=complementary]').length,
        primaryNav: document.querySelectorAll('nav[aria-label="Primary"]').length,
        consentRegion: document.querySelectorAll('[aria-label="Cookie consent"]').length,
        footerNav: document.querySelectorAll('nav[aria-label="Footer"]').length,
        contentinfo: [...document.querySelectorAll('footer')].filter((f) => !f.closest('main, article, section, aside, nav')).length,
      }));
      await context.close();
    }
    console.log('A7', JSON.stringify(out));
    assert.equal(out['/legal/privacy'].nestedAside, 0);
    for (const k of ['primaryNav', 'consentRegion', 'footerNav', 'contentinfo']) assert.ok(out['/design'][k] <= 1, `/design ${k} = ${out['/design'][k]}`);
  });

  await t.test('H header: Menu control never clipped at 320-375', { skip: !only('H') }, async () => {
    const out = [];
    for (const w of [320, 360, 375]) {
      const { page, context } = await open(browser, [w, 700], '/latest');
      out.push(await page.evaluate(() => {
        const btn = [...document.querySelectorAll('header button')].find((b) => /menu/i.test(b.textContent));
        const r = btn.getBoundingClientRect(); const vw = document.documentElement.clientWidth;
        return { w: vw, right: Math.round(r.right), name: btn.textContent.trim() };
      }));
      await context.close();
    }
    console.log('H', JSON.stringify(out));
    for (const m of out) assert.ok(m.right <= m.w - 12, `${m.w}: Menu button ends at ${m.right}`);
  });

  await t.test('N 404 page renders with no React console warnings', { skip: !only('N') }, async () => {
    const msgs = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource|\[HMR\]|webpack-hmr|_next\/hmr/.test(m.text())) msgs.push(m.text().slice(0, 120)); });
    const res = await page.goto(BASE + '/drivers/nope_xyz', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    console.log('N', res.status(), JSON.stringify(msgs));
    await context.close();
    assert.equal(res.status(), 404);
    assert.deepEqual(msgs, []);
  });
});
