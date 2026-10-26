/**
 * Quality gate: real-browser checks for one route at one width.
 *
 * Every check here runs in a real Chromium page. The same function is used
 * against the live site (route matrix) and against the deliberately broken
 * fixtures in selftest (proof that each check catches its bug class).
 *
 * Problem classes (audits 2026-10-25, 2026-10-26 round 3):
 *   overflow, clipped text, negative tracking under 24px, broken images,
 *   portraits cropped through faces, console errors, CLS > 0.02, missing
 *   primary nav / Give back, small tap targets on primary controls, content
 *   left hidden by scroll reveals, serious/critical axe issues.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { measureInPage } from '../../browser/layout-audit.mjs';

const require = createRequire(import.meta.url);

export const CLS_LIMIT = 0.02;
export const TAP_MIN = 44;

export async function launchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({ headless: true });
}

export function axeSource() {
  return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
}

/** Context for a width: touch emulation at 1024 px and below, mobile viewport at 820 and below. */
export async function newContext(browser, width, { height = 900 } = {}) {
  const touch = width <= 1024;
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: touch,
    isMobile: width <= 820,
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(() => {
    // A returning visitor's stored consent choice keeps the banner out of measurements.
    try { localStorage.setItem('apex.consent.v1', JSON.stringify({ analytics: false, marketing: false, ts: new Date().toISOString() })); } catch { /* storage blocked */ }
    // CLS as web-vitals defines it: largest session window (1 s gap, 5 s max) of shifts without recent input.
    window.__qaCls = { value: 0, window: 0, first: 0, last: 0, sources: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          const s = window.__qaCls;
          if (s.window && e.startTime - s.last < 1000 && e.startTime - s.first < 5000) s.window += e.value;
          else { s.window = e.value; s.first = e.startTime; }
          s.last = e.startTime;
          if (s.window > s.value) s.value = s.window;
          if (e.value > 0.001 && s.sources.length < 6) {
            const node = e.sources?.[0]?.node;
            const name = node && node.nodeType === 1 ? `${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}${node.className && typeof node.className === 'string' ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}` : '?';
            s.sources.push(`${name} +${e.value.toFixed(3)}`);
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* layout-shift not supported */ }
  });
  return context;
}

/** Scroll through the page so lazy media and scroll reveals run, then return to the top. */
export async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 140));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  // Images that started loading during the scroll get a bounded chance to finish.
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 8_000 }).catch(() => {});
}

/** Gate-specific measurements that layout-audit.mjs does not cover. Self-contained (serialised). */
export function inspectExtras(tapMin) {
  const out = { cls: window.__qaCls ? { value: window.__qaCls.value, sources: window.__qaCls.sources } : null, tap: [], portraits: [], hiddenContent: [], nav: {} };
  const visible = (el) => {
    if (el.closest('[inert],[aria-hidden="true"]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label').slice(0, 40)}"]` : ''} "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;

  // Primary controls: header/nav/menu links and buttons, tabs, form controls and every <button>.
  const primary = document.querySelectorAll('header a, header button, nav a, nav button, [role="dialog"] a, [role="dialog"] button, [role="tab"], button, input:not([type="hidden"]), select, [role="button"]');
  const seen = new Set();
  for (const el of primary) {
    if (seen.has(el) || !visible(el)) continue;
    seen.add(el);
    // Inline links inside running text are not primary controls (WCAG 2.5.8 inline exception);
    // nor are the footer index and breadcrumb trails (secondary navigation).
    // A page's own <header> inside <main> is content, not the site chrome: only nav and the site banner count.
    if (el.tagName === 'A' && el.closest('p, li p, blockquote, figcaption, td') && !el.closest('nav, header[data-shell], body > header, [role="banner"]')) continue;
    // The design preview of the footer ([data-shell="footer-preview"]) is that same footer index.
    if (el.closest('footer, [data-shell="footer-preview"], nav[aria-label*="readcrumb" i]') && !el.matches('button, input, select')) continue;
    let r = el.getBoundingClientRect();
    // A checkbox or radio is toggled by its whole <label>: the hit area is the larger of the box and a visible label.
    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      for (const l of el.labels ?? []) { const lr = l.getBoundingClientRect(); if (visible(l) && lr.width * lr.height > r.width * r.height) r = lr; }
    }
    if (r.width < tapMin - 0.5 || r.height < tapMin - 0.5) out.tap.push({ el: label(el), size: `${Math.round(r.width)}x${Math.round(r.height)}` });
  }

  // Portraits: a vertically cropped head-and-shoulders photo must stay anchored near the top.
  for (const img of document.querySelectorAll('[data-portrait] img, .ds-portrait img, img[data-portrait]')) {
    if (!visible(img) || !img.naturalWidth) continue;
    const s = getComputedStyle(img);
    if (s.objectFit !== 'cover') continue;
    const r = img.getBoundingClientRect();
    const natural = img.naturalWidth / img.naturalHeight;
    const frame = r.width / r.height;
    if (natural >= frame) continue; // horizontal crop only: faces stay in frame
    const y = s.objectPosition.split(/\s+/)[1] ?? '50%';
    const pct = y.endsWith('%') ? parseFloat(y) : (y === 'top' ? 0 : y === 'bottom' ? 100 : y === 'center' ? 50 : NaN);
    const lostTop = (1 - natural / frame) * ((Number.isFinite(pct) ? pct : 50) / 100);
    if (lostTop > 0.08) out.portraits.push({ src: (img.currentSrc || img.src).slice(0, 140), position: s.objectPosition, lostTop: Math.round(lostTop * 100) });
  }

  // Content left invisible after every reveal had its chance to run (scrolled through, then back to top).
  const main = document.querySelector('main') ?? document.body;
  for (const el of main.querySelectorAll('h1, h2, h3, p, li, td, figure, img, a, section > div')) {
    if (el.closest('[inert],[aria-hidden="true"],details:not([open]),[hidden],template,dialog:not([open]),.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const text = (el.textContent || '').trim();
    if (el.tagName !== 'IMG' && text.length < 12) continue;
    let hiddenBy = null;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.visibility === 'hidden') { hiddenBy = 'visibility:hidden'; break; }
      if (Number(s.opacity) < 0.05) { hiddenBy = `opacity:${s.opacity}`; break; }
      if (s.clipPath && /inset\(\s*(100%|50%)/.test(s.clipPath)) { hiddenBy = `clip-path:${s.clipPath}`; break; }
    }
    if (hiddenBy && out.hiddenContent.length < 8) out.hiddenContent.push({ el: label(el), hiddenBy });
  }

  // Primary navigation and the Give back link (/support): owner decision, never removed.
  const header = document.querySelector('header[data-shell="nav"]') ?? document.querySelector('body > header, header');
  out.nav.header = Boolean(header && visible(header));
  out.nav.home = Boolean(header && [...header.querySelectorAll('a[href="/"]')].some(visible));
  out.nav.primaryNav = Boolean([...document.querySelectorAll('nav[aria-label="Primary"]')].some(visible));
  out.nav.menuButton = Boolean(header && [...header.querySelectorAll('button[aria-expanded]')].some(visible));
  out.nav.giveBackVisible = Boolean(header && [...header.querySelectorAll('a[href="/support"]')].some(visible));
  return out;
}

/** If Give back is not in the header bar, it must be one tap away in the menu. */
async function giveBackViaMenu(page) {
  const button = page.locator('header button[aria-expanded]').first();
  if (!(await button.count())) return false;
  await button.click();
  const link = page.locator('dialog[open] a[href="/support"], [role="dialog"] a[href="/support"], #site-menu a[href="/support"]').first();
  const ok = await link.isVisible({ timeout: 3_000 }).catch(() => false);
  await page.keyboard.press('Escape').catch(() => {});
  return ok;
}

/**
 * Load, settle and measure one URL at one width. Returns structured findings
 * and a flat `problems` list (empty means clean).
 */
export async function checkRoute(browser, url, width, { axe = null, expectStatus = [200], allowConsole = [] } = {}) {
  const context = await newContext(browser, width);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().replace(/\s+/g, ' ').slice(0, 220)); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message || e).slice(0, 220)}`));
  const problems = [];
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    const status = response?.status() ?? 0;
    if (!expectStatus.includes(status)) problems.push({ check: 'status', detail: `HTTP ${status}` });
    await settle(page);
    const layout = await page.evaluate(measureInPage);
    const extra = await page.evaluate(inspectExtras, TAP_MIN);
    if (layout.overflow) problems.push({ check: 'overflow', detail: `scrollWidth ${layout.overflow.scrollWidth} > ${layout.overflow.viewport}: ${layout.overflow.culprits.slice(0, 3).join(' | ')}` });
    for (const t of layout.tracking) problems.push({ check: 'tracking', detail: `${t.letterSpacing} at ${t.fontSize}px: ${t.el} "${t.text}"` });
    for (const c of layout.clipped) problems.push({ check: 'clipped', detail: `(${c.reason}) ${c.el} "${c.text}"` });
    for (const h of layout.hiddenScroll ?? []) problems.push({ check: 'clipped', detail: `table cut off with no scroll cue (${h.reason}) ${h.el}` });
    for (const b of layout.brokenWords ?? []) problems.push({ check: 'clipped', detail: `word broken across lines: ${b.el} "${b.word}"` });
    for (const i of layout.images) problems.push({ check: i.problem === 'broken' ? 'broken-image' : 'image-crop', detail: `${i.problem}: ${i.src}` });
    for (const p of extra.portraits) problems.push({ check: 'image-crop', detail: `portrait cropped through the face (top ${p.lostTop}% lost, object-position ${p.position}): ${p.src}` });
    for (const t of extra.tap) problems.push({ check: 'tap-target', detail: `${t.size} < ${TAP_MIN}px: ${t.el}` });
    for (const h of extra.hiddenContent) problems.push({ check: 'hidden-content', detail: `${h.hiddenBy}: ${h.el}` });
    if (extra.cls && extra.cls.value > CLS_LIMIT) problems.push({ check: 'cls', detail: `CLS ${extra.cls.value.toFixed(3)} > ${CLS_LIMIT}: ${extra.cls.sources.join(', ')}` });
    const nav = extra.nav;
    if (!nav.header || !nav.home) problems.push({ check: 'nav', detail: 'no visible site header with a home link' });
    if (!nav.primaryNav && !nav.menuButton) problems.push({ check: 'nav', detail: 'neither the primary nav nor a menu button is visible' });
    if (!nav.giveBackVisible && !(await giveBackViaMenu(page))) problems.push({ check: 'nav', detail: 'Give back (/support) not reachable from the header or the menu' });
    if (axe) {
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
        return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
      });
      for (const v of violations) problems.push({ check: 'axe', detail: `${v.impact} ${v.id}: ${v.nodes.join(' , ')}` });
    }
    for (const e of consoleErrors) {
      if (allowConsole.some((re) => re.test(e))) continue;
      problems.push({ check: 'console', detail: e });
    }
    return { url, width, status, problems };
  } finally {
    await context.close();
  }
}
