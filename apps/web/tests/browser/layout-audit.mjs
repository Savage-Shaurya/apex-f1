/**
 * Layout integrity audit, run inside a real browser page (Playwright).
 *
 * Measures what the user asked never to ship (2026-10-25):
 *   - horizontal page overflow;
 *   - negative letter-spacing on any visible text under 24px;
 *   - text clipped by its own box (scrollWidth > clientWidth with overflow
 *     hidden/clip, or an ellipsis) or cut by an ancestor's overflow;
 *   - broken images, and photos cropped hard by object-fit: cover;
 *   - console errors (collected by the caller) and serious/critical axe issues.
 *
 * Used by layout-integrity.test.mjs (cross-page test, every route group at
 * 1440/768/390/320) and by the designers' audit scripts. No dependencies:
 * the caller passes a Playwright `page` and, optionally, the axe-core source.
 */

/** Runs in the page. Must stay self-contained (it is serialised by Playwright). */
export function measureInPage() {
  const TOLERANCE = 1.5;
  const doc = document.documentElement;
  const findings = { overflow: null, tracking: [], clipped: [], brokenWords: [], images: [] };

  const viewport = doc.clientWidth;
  if (doc.scrollWidth > viewport + 1) {
    // Culprits: boxes past the right edge that no ancestor below <body> clips
    // (body's overflow propagates to the viewport, so it does not clip them).
    // Includes sr-only text whose absolute box escapes an unpositioned scroller.
    const wide = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right <= viewport + 1) continue;
      let clipped = false;
      const position = getComputedStyle(el).position;
      // An absolutely positioned box is clipped only by overflow at or above its
      // containing block; a fixed box only by a transformed ancestor.
      let waiting = position === 'absolute' || position === 'fixed';
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const as = getComputedStyle(a);
        if (waiting) {
          const establishes = as.transform !== 'none' || as.filter !== 'none' || /paint|layout|strict|content/.test(as.contain) || (position === 'absolute' && as.position !== 'static');
          if (!establishes) continue;
          waiting = false;
        }
        if (as.overflowX !== 'visible') { clipped = true; break; }
      }
      if (!clipped) wide.push(describe(el) + ` right=${Math.round(r.right)}`);
      if (wide.length >= 8) break;
    }
    findings.overflow = { scrollWidth: doc.scrollWidth, viewport, culprits: wide };
  }

  function describe(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 140);
  }

  function visible(el, style) {
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    // Screen-reader-only text (1px clipped boxes) is not visible text.
    if (el.closest('.sr-only, [aria-hidden="true"] .sr-only')) return false;
    return true;
  }

  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.textContent;
    return text.replace(/\s+/g, ' ').trim();
  }

  function textRect(el) {
    const range = document.createRange();
    let rect = null;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width === 0) continue;
        rect = rect
          ? { left: Math.min(rect.left, r.left), right: Math.max(rect.right, r.right), top: Math.min(rect.top, r.top), bottom: Math.max(rect.bottom, r.bottom) }
          : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    }
    return rect;
  }

  const clipsX = (s) => s.overflowX === 'hidden' || s.overflowX === 'clip';
  const clipsY = (s) => s.overflowY === 'hidden' || s.overflowY === 'clip';
  // Content of a closed <details> is not rendered for the reader (Chrome still lays it out under
  // content-visibility: hidden), so it can be neither clipped nor broken.
  const inClosedDetails = (el) => { const d = el.closest('details:not([open])'); return Boolean(d && !el.closest('summary')); };
  const ignored = (el) => el.closest('svg, .ds-marquee, [inert], script, style, noscript, [data-allow-clip]') || inClosedDetails(el);

  for (const el of document.body.querySelectorAll('*')) {
    if (ignored(el)) continue;
    const text = ownText(el);
    if (!text) continue;
    const style = getComputedStyle(el);
    if (!visible(el, style)) continue;
    const size = parseFloat(style.fontSize);
    const spacing = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing);
    if (size < 24 && spacing < -0.01) {
      findings.tracking.push({ el: describe(el), text: text.slice(0, 60), fontSize: Math.round(size * 10) / 10, letterSpacing: style.letterSpacing });
    }

    // Own box: content wider than the box while overflow hides it, or an ellipsis.
    if ((clipsX(style) && el.scrollWidth > el.clientWidth + TOLERANCE) || (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + TOLERANCE)) {
      findings.clipped.push({ el: describe(el), text: text.slice(0, 60), reason: `own box ${el.scrollWidth}>${el.clientWidth}` });
      continue;
    }
    if (style.webkitLineClamp && style.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + TOLERANCE) {
      findings.clipped.push({ el: describe(el), text: text.slice(0, 60), reason: 'line-clamp' });
      continue;
    }

    // Ancestors that hide overflow and cut the text's line boxes.
    const rect = textRect(el);
    if (!rect) continue;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      // Text inside a scroller can be scrolled to; ancestors further out clip the scroller's box, not the text.
      if (/auto|scroll/.test(as.overflowX) || /auto|scroll/.test(as.overflowY)) break;
      const cx = clipsX(as), cy = clipsY(as);
      if (!cx && !cy) continue;
      const ar = a.getBoundingClientRect();
      // Text that has been moved out of view on purpose (a closed panel) is not clipped text.
      if (rect.right < ar.left || rect.left > ar.right || rect.bottom < ar.top || rect.top > ar.bottom) break;
      const cutX = cx && (rect.left < ar.left - TOLERANCE || rect.right > ar.right + TOLERANCE);
      // Line boxes include the font's full ascent/descent; allow 2px before calling a vertical cut.
      const cutY = cy && (rect.top < ar.top - 2 || rect.bottom > ar.bottom + 2);
      if (cutX || cutY) {
        findings.clipped.push({ el: describe(el), text: text.slice(0, 60), reason: `cut by ${describe(a)} (${cutX ? 'x' : ''}${cutY ? 'y' : ''})` });
        break;
      }
    }
  }

  // Tables that scroll sideways with no visible cue: the last columns (often
  // the points) are cut off at the frame edge. Scrollers that announce
  // themselves (data-scroll-hint, rendered by DataTable when it is not `fit`)
  // are allowed.
  findings.hiddenScroll = [];
  for (const table of document.body.querySelectorAll('table')) {
    if (ignored(table)) continue;
    for (let a = table.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (as.overflowX !== 'auto' && as.overflowX !== 'scroll') continue;
      if (a.scrollWidth > a.clientWidth + TOLERANCE && !a.closest('[data-scroll-hint]') && visible(a, as)) {
        findings.hiddenScroll.push({ el: describe(a), text: (a.getAttribute('aria-label') || table.querySelector('caption')?.textContent || '').trim().slice(0, 60), reason: `${a.scrollWidth}>${a.clientWidth}` });
      }
      break;
    }
  }

  // Words split across two lines (overflow-wrap breaking a name like VERSTAP/PEN).
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let checked = 0;
  for (let node = walker.nextNode(); node && checked < 6000; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || ignored(parent) || parent.closest('.sr-only, [aria-hidden="true"], input, textarea')) continue;
    const ps = getComputedStyle(parent);
    if (!visible(parent, ps) || ps.hyphens === 'auto') continue;
    const text = node.textContent;
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’]{3,}/gu; // hyphens and dashes are legitimate break points
    for (let m = re.exec(text); m; m = re.exec(text)) {
      checked++;
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const tops = new Set(rects.map((r) => Math.round(r.top)));
      if (tops.size > 1) {
        findings.brokenWords.push({ el: describe(parent), word: m[0] });
        if (findings.brokenWords.length >= 20) break;
      }
    }
  }

  for (const img of document.images) {
    if (img.closest('[inert]')) continue;
    const style = getComputedStyle(img);
    const r = img.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const src = (img.currentSrc || img.src || '').slice(0, 160);
    if (img.complete && img.naturalWidth === 0) {
      findings.images.push({ src, problem: 'broken' });
      continue;
    }
    if (img.naturalWidth && style.objectFit === 'cover') {
      const natural = img.naturalWidth / img.naturalHeight;
      const box = r.width / r.height;
      const loss = Math.abs(natural - box) / Math.max(natural, box);
      // The no-crop media rule allows cover only within 20% of the frame ratio.
      if (loss > 0.21) findings.images.push({ src, problem: `cover crops ${Math.round(loss * 100)}% (natural ${natural.toFixed(2)}, frame ${box.toFixed(2)})` });
    }
  }
  return findings;
}

/** Scroll the page once so lazy images and below-the-fold sections render. */
export async function settlePage(page) {
  await page.evaluate(async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 300));
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
}

/** Serious and critical axe-core violations (WCAG 2.x A/AA). */
export async function runAxe(page, axeSource) {
  if (!axeSource) return [];
  await page.addScriptTag({ content: axeSource });
  const result = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
  });
  return result;
}

/** One route at one width: load, settle, measure. Console errors are collected while loading. */
export async function auditRoute(browser, url, width, { axeSource, height = 900, reducedMotion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion });
  // Keep the consent banner out of measurements (a stored choice, as a returning visitor has).
  await context.addInitScript(() => {
    try { localStorage.setItem('apex.consent.v1', JSON.stringify({ analytics: false, marketing: false, ts: new Date().toISOString() })); } catch { /* storage blocked */ }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message || e).slice(0, 240)));
  let status = 0;
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
    status = response?.status() ?? 0;
    await settlePage(page);
    const findings = await page.evaluate(measureInPage);
    const axe = await runAxe(page, axeSource);
    return { url, width, status, ...findings, axe, consoleErrors, page, context };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Human-readable problems for one audited route (empty when clean). */
export function problemsOf(result, { allowStatus = [200] } = {}) {
  const out = [];
  if (!allowStatus.includes(result.status)) out.push(`HTTP ${result.status}`);
  if (result.overflow) out.push(`horizontal overflow ${result.overflow.scrollWidth}>${result.overflow.viewport}: ${result.overflow.culprits.join(' | ')}`);
  for (const t of result.tracking) out.push(`negative tracking ${t.letterSpacing} at ${t.fontSize}px: ${t.el} "${t.text}"`);
  for (const c of result.clipped) out.push(`clipped text (${c.reason}): ${c.el} "${c.text}"`);
  for (const h of result.hiddenScroll ?? []) out.push(`table cut off with no scroll cue (${h.reason}): ${h.el} "${h.text}"`);
  for (const b of result.brokenWords ?? []) out.push(`word broken across lines: ${b.el} "${b.word}"`);
  for (const i of result.images) out.push(`image ${i.problem}: ${i.src}`);
  for (const a of result.axe) out.push(`axe ${a.impact} ${a.id}: ${a.nodes.join(' , ')}`);
  for (const e of result.consoleErrors) out.push(`console error: ${e}`);
  return out;
}
