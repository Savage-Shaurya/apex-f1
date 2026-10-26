/**
 * Forbidden patterns: things the owner asked never to ship again.
 *
 * Two layers use the same rule list:
 *   - static: `scanSource(text, file)` over apps/web/{app,components,lib}
 *     (comments and import lines removed, tests excluded);
 *   - rendered: `scanRendered(page facts, route)` over what a real browser
 *     shows (body text, image sources, links), run in the route matrix.
 */

/** The owner's four links, exactly (2026-10-26). */
export const FOOTER_SOCIALS = ['https://www.instagram.com/snappy_leader/', 'https://x.com/SnappyLeader', 'https://www.linkedin.com/in/shaurya-punj-86a3b4444/', 'mailto:shaurya@snappycrew.com'];
/** Retired contact values that must never appear again. */
export const OLD_VALUES = ['workwithshaurya10@gmail.com', 'ShAuRyANoodle', 'shaurya-punj-2287513b3'];

/** Routes where naming the data providers is the point (credits) or required (legal). */
export const PROVIDER_COPY_ALLOWED = [/^\/references(\/|$)/, /^\/legal(\/|$)/];

const PROVIDER_NAMES = /\b(Jolpica|Ergast|OpenF1|Open-Meteo|NewsAPI|GNews|NewsData|Currents API|Guardian API)\b/i;
const PROVIDER_MECHANICS = /\b(data checked|checked against|cross[- ]checked|verified against|refreshed every \d+|cache[ds]? (?:for|every)|via (?:the )?(?:API|feed)|upstream|provider)\b/i;

/** The owner's GitHub accounts, as a link or a bare handle. */
export const OWNER_GITHUB = /\b(?:ShAuRyA-Noodle|Savage-Shaurya)\b/i;

export const STATIC_RULES = [
  { id: 'gantry', why: 'five-light start gantry component (removed by owner)', test: /\b(?:gantry|five[-_ ]?lights?|StartLights|StartLightGantry|LightsOutGantry)\b/i, files: /\.(tsx|ts|css)$/ },
  { id: 'dots', why: 'decorative dot classes or dot-grid backgrounds', test: /(?:class(?:Name)?=["'`{][^"'`}]*\b(?:dot|dots|dot-grid|bg-dots|dotted-bg|[\w-]+-dot)\b)|(?:\.(?:dot|dots|dot-grid|bg-dots|[\w-]+-dot)\s*[,{])|(?:radial-gradient\([^)]*\b1px\b[^)]*\)\s*0\s*0\s*\/)/, files: /\.(tsx|css)$/ },
  { id: 'cursor', why: 'custom cursor', test: /\bcursor:\s*none\b|\bcursor-none\b|\b(?:CustomCursor|CursorFollower|cursor-follower|MagneticCursor)\b/, files: /\.(tsx|ts|css)$/ },
  // Owner 2026-10-26 (clarified): HIS GitHub accounts must never appear anywhere. Third-party
  // open-source, data and font credit links to github.com (on /references) are allowed.
  { id: 'github', why: "the owner's GitHub account (ShAuRyA-Noodle / Savage-Shaurya)", test: OWNER_GITHUB, files: /\.(tsx|ts|json|mdx?)$/ },
  { id: 'old-contact', why: 'retired contact value', test: /workwithshaurya10@gmail\.com|ShAuRyANoodle|shaurya-punj-2287513b3/, files: /\.(tsx|ts|json|mdx?)$/ },
  { id: 'stock-media', why: 'Unsplash / Giphy / placeholder images', test: /\b(?:images\.unsplash\.com|unsplash\.com\/photos|media\d?\.giphy\.com|giphy\.com\/(?:media|gifs)|picsum\.photos|placehold\.co|via\.placeholder\.com|dummyimage\.com|placeholder\.(?:png|jpe?g|svg|webp))\b/i, files: /\.(tsx|ts|css)$/ },
  { id: 'lorem', why: 'lorem ipsum filler', test: /\blorem ipsum(?: dolor sit amet)?\b|\bdolor sit amet\b/i, files: /\.(tsx|ts|mdx?)$/ },
  { id: 'provider-copy', why: 'provider names or data-pipeline mechanics in visible copy', test: null, files: /\.tsx$/ },
];

/** Remove comments and import/export-from lines so only shipped code and copy remain. */
export function stripNonCopy(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
    .replace(/^[ \t]*(?:import|export)[ \t][^\n]*\bfrom[ \t]+['"][^'"]+['"];?[ \t]*$/gm, (m) => ' '.repeat(m.length))
    .replace(/^[ \t]*import[ \t]+['"][^'"]+['"];?[ \t]*$/gm, (m) => ' '.repeat(m.length));
}

/** Visible copy in a TSX file: JSX text nodes and string-literal JSX attribute values that people read. */
export function jsxCopy(text) {
  const out = [];
  const textNode = />\s*([^<>{}]*[A-Za-z][^<>{}]*)\s*</g;
  for (const m of text.matchAll(textNode)) {
    // Prose, not code between type parameters: words and spaces, no call/assignment syntax.
    if (/[();=]|=>|\w\.\w+\(/.test(m[1]) || !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(m[1])) continue;
    out.push({ index: m.index, copy: m[1] });
  }
  const attr = /\b(?:aria-label|title|alt|label|description|summary|caption|note|message)=["']([^"']{4,})["']/g;
  for (const m of text.matchAll(attr)) out.push({ index: m.index, copy: m[1] });
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Violations in one source file. `file` is repo-relative (posix). Route
 * files under app/references and app/legal may name providers.
 */
export function scanSource(rawText, file) {
  const text = stripNonCopy(rawText);
  const hits = [];
  for (const rule of STATIC_RULES) {
    if (!rule.files.test(file) || rule.allowFiles?.test(file)) continue;
    if (rule.id === 'provider-copy') {
      // Credits and legal pages name providers on purpose; /admin is the owner's console.
      if (/(^|\/)app\/(references|legal|admin)\//.test(file)) continue;
      for (const { index, copy } of jsxCopy(text)) {
        const m = copy.match(PROVIDER_NAMES) ?? copy.match(PROVIDER_MECHANICS);
        if (m) hits.push({ rule: rule.id, why: rule.why, file, line: lineOf(text, index), match: copy.trim().slice(0, 100) });
      }
      continue;
    }
    for (const m of text.matchAll(new RegExp(rule.test.source, rule.test.flags.includes('g') ? rule.test.flags : rule.test.flags + 'g'))) {
      hits.push({ rule: rule.id, why: rule.why, file, line: lineOf(text, m.index), match: m[0].slice(0, 100) });
    }
  }
  return hits;
}

/** Collected in the page by `renderedFacts`, checked here (pure, unit-tested). */
export function scanRendered(facts, route) {
  const out = [];
  const path = route.split('?')[0];
  const providerAllowed = PROVIDER_COPY_ALLOWED.some((re) => re.test(path));
  if (!providerAllowed) {
    const m = facts.mainText.match(PROVIDER_NAMES) ?? facts.mainText.match(PROVIDER_MECHANICS);
    if (m) {
      const i = facts.mainText.indexOf(m[0]);
      out.push({ check: 'forbidden', detail: `provider copy "${facts.mainText.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, ' ')}"` });
    }
  }
  if (/\blorem ipsum\b|\bdolor sit amet\b/i.test(facts.bodyText)) out.push({ check: 'forbidden', detail: 'lorem ipsum in page text' });
  for (const src of facts.imageSources) {
    if (/unsplash\.com|giphy\.com|picsum\.photos|placehold\.co|via\.placeholder\.com|dummyimage\.com|placeholder\.(png|jpe?g|svg|webp)/i.test(src)) out.push({ check: 'forbidden', detail: `stock/placeholder image ${src.slice(0, 120)}` });
  }
  // Owner 2026-10-26 (clarified): his GitHub accounts never appear; third-party credit links to github.com are fine.
  for (const href of facts.links) if (OWNER_GITHUB.test(href)) out.push({ check: 'forbidden', detail: `owner GitHub link ${href}` });
  { const m = facts.bodyText.match(OWNER_GITHUB); if (m) out.push({ check: 'forbidden', detail: `owner GitHub handle "${m[0]}" in page text` }); }
  if (facts.gantry) out.push({ check: 'forbidden', detail: `five-light gantry element: ${facts.gantry}` });
  if (facts.cursorNone) out.push({ check: 'forbidden', detail: `custom cursor (cursor:none on ${facts.cursorNone})` });
  if (!facts.footerLinks.length) out.push({ check: 'forbidden', detail: 'no footer links (footer missing)' });
  else {
    const missing = FOOTER_SOCIALS.filter((s) => !facts.footerLinks.includes(s));
    if (missing.length) out.push({ check: 'forbidden', detail: `footer socials missing or changed: ${missing.join(', ')}` });
  }
  const credit = facts.footerText.match(/[^.\n]*\b(affiliated|licen[cs]ed?|CC BY[\w.-]*|credits?)\b[^.\n]*/i);
  if (credit) out.push({ check: 'forbidden', detail: `credit/licence text in the footer: "${credit[0].trim().slice(0, 100)}"` });
  if (!providerAllowed) for (const c of facts.captions) out.push({ check: 'forbidden', detail: `credit caption outside /references: "${c}"` });
  for (const value of OLD_VALUES) if (facts.html.includes(value)) out.push({ check: 'forbidden', detail: `retired contact value on the page: ${value}` });
  return out;
}

/** Runs in the page. Self-contained. */
export function renderedFacts() {
  const main = document.querySelector('main') ?? document.body;
  const imgs = [...document.images].map((i) => i.currentSrc || i.src);
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) imgs.push(m[1]);
  }
  let cursorNone = null;
  for (const el of [document.documentElement, document.body, ...document.querySelectorAll('main, main *, header, header *')].slice(0, 4000)) {
    if (getComputedStyle(el).cursor === 'none') { cursorNone = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''); break; }
  }
  // A start gantry: a row of five identical round "lights", however it is named.
  let gantry = null;
  const named = document.querySelector('[class*="gantry" i], [data-gantry], [class*="start-light" i], [class*="startlight" i]');
  if (named) gantry = named.tagName.toLowerCase() + '.' + String(named.className).slice(0, 60);
  if (!gantry) {
    for (const row of document.querySelectorAll('div, ul, span')) {
      const kids = [...row.children];
      if (kids.length !== 5) continue;
      const round = kids.every((k) => {
        const s = getComputedStyle(k); const r = k.getBoundingClientRect();
        return r.width >= 8 && Math.abs(r.width - r.height) < 1 && parseFloat(s.borderRadius) >= r.width / 2 - 1 && (k.textContent || '').trim() === '';
      });
      if (round) { gantry = `${row.tagName.toLowerCase()}.${String(row.className).slice(0, 60)} (5 round empty children)`; break; }
    }
  }
  const footer = document.querySelector('footer');
  // "Photo: ...", "Outline: ...", "Data: ...", "Source: ..." captions (credits belong on /references).
  const captions = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || '').trim();
    if (!/^(Photo|Outline|Data|Source)\s*:/i.test(t)) continue;
    const el = n.parentElement;
    if (!el || el.closest('script,style,[aria-hidden="true"],[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (captions.length < 5) captions.push(t.replace(/\s+/g, ' ').slice(0, 80));
  }
  return {
    footerText: footer ? (footer.innerText || '') : '',
    captions,
    html: document.documentElement.outerHTML,
    mainText: main.innerText || '',
    bodyText: document.body.innerText || '',
    imageSources: imgs,
    links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
    footerLinks: footer ? [...footer.querySelectorAll('a[href]')].map((a) => a.href) : [],
    cursorNone,
    gantry,
  };
}
