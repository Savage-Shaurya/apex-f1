/**
 * Self-test fixtures: one clean page and one deliberately broken variant per
 * bug class, served from a local HTTP server. The gate's own checks
 * (checkRoute, renderedFacts, historyFlow, linkCrawl) must pass the clean page
 * and fail every broken one; otherwise the gate itself is broken.
 */
import http from 'node:http';

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SOCIALS = ['https://www.instagram.com/snappy_leader/', 'https://x.com/SnappyLeader', 'https://www.linkedin.com/in/shaurya-punj-86a3b4444/', 'mailto:shaurya@snappycrew.com'];

function page({ head = '', main = '', header, footer, script = '' } = {}) {
  const headerHtml = header ?? `<header data-shell="nav" style="display:flex;gap:8px;align-items:center;padding:8px">
      <a href="/" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center">Apex</a>
      <nav aria-label="Primary"><a href="/clean2" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center">Results</a></nav>
      <a href="/support" style="display:inline-flex;min-width:44px;min-height:44px;align-items:center">Give back</a>
      <button aria-expanded="false" id="menu" style="min-width:44px;min-height:44px">Menu</button>
    </header>`;
  const footerHtml = footer ?? `<footer><ul>${SOCIALS.map((h, i) => `<li><a href="${h}" style="display:inline-flex;min-width:44px;min-height:44px">${['Instagram', 'X', 'LinkedIn', 'Email'][i]}</a></li>`).join('')}</ul></footer>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture</title>
  <style>body{margin:0;font:16px/1.5 system-ui;color:#000;background:#fff} main{padding:16px} a{color:#000}</style>${head}</head>
  <body>${headerHtml}<main><h1>Fixture page</h1><p>Lando Norris won the United States Grand Prix from pole position.</p>${main}</main>${footerHtml}${script}</body></html>`;
}

export const VARIANTS = {
  clean: { html: page(), expect: [] },
  clean2: { html: page(), expect: [] },
  support: { html: page(), expect: [] },
  overflow: { html: page({ main: '<div style="width:2400px;height:20px;background:#000"></div>' }), expect: ['overflow'] },
  tracking: { html: page({ main: '<p style="font-size:14px;letter-spacing:-0.06em">Tight tracking on small text is unreadable.</p>' }), expect: ['tracking'] },
  clipped: { html: page({ main: '<div style="width:120px;overflow:hidden;white-space:nowrap">Max Verstappen finished second after a late safety car</div>' }), expect: ['clipped'] },
  'broken-image': { html: page({ main: '<img src="/missing-image.png" alt="Car" width="200" height="100">' }), expect: ['broken-image'] },
  portrait: { html: page({ main: '<div data-portrait style="width:300px;height:150px"><img src="/tall.png" alt="Driver" style="width:300px;height:150px;object-fit:cover;object-position:50% 100%"></div>' }), expect: ['image-crop'] },
  console: { html: page({ script: '<script>console.error("boom: hydration failed")</script>' }), expect: ['console'] },
  cls: { html: page({ main: '<p id="late-anchor">Standings table follows.</p><div style="height:600px">table</div>', script: '<script>setTimeout(()=>{const d=document.createElement("div");d.style.height="320px";d.textContent="late banner";document.querySelector("main").prepend(d)},1200)</script>' }), expect: ['cls'] },
  'no-nav': { html: page({ header: '<div>No header here</div>' }), expect: ['nav'] },
  'no-give-back': { html: page({ header: '<header data-shell="nav"><a href="/" style="display:inline-flex;min-width:44px;min-height:44px">Apex</a><nav aria-label="Primary"><a href="/clean2" style="display:inline-flex;min-width:44px;min-height:44px">Results</a></nav></header>' }), expect: ['nav'] },
  // WCAG 2.5.8 inline exception: a link inside a sentence in a page header (not the site banner) is not a control.
  'inline-link-page-header': { html: page({ main: '<header><p>One email before each race. See the <a href="/clean2">privacy policy</a> for details.</p></header>' }), expect: [] },
  // Gate precision: content of a closed <details> is not rendered, and text inside a scroller is reachable.
  'closed-details': { html: page({ main: '<section style="overflow:hidden;border-radius:22px"><p>Points by round for the leading drivers.</p><details><summary style="display:inline-flex;min-height:44px;align-items:center">Show the chart as a table</summary><div><table><tbody>' + Array.from({ length: 12 }, (_, i) => `<tr><th style="white-space:nowrap">R${i + 1} Canadian Grand Prix</th><td>${100 + i}</td></tr>`).join('') + '</tbody></table></div></details></section>' }), expect: [] },
  'clipped-by-scroller-parent': { html: page({ main: '<section style="overflow:hidden"><div style="overflow-x:auto" data-scroll-hint><p style="white-space:nowrap;width:1600px">Russell Antonelli Verstappen Leclerc Norris Piastri Hamilton</p></div></section>' }), expect: [] },
  'tap-target': { html: page({ main: '<button style="width:20px;height:20px;padding:0" aria-label="Play">▶</button>' }), expect: ['tap-target'] },
  // A bare 20px checkbox is a small target; the same box inside a 44px-tall full-width label row is not (the label is the hit area).
  'tap-checkbox': { html: page({ main: '<input type="checkbox" aria-label="Race-week edition" style="width:20px;height:20px;margin:0">' }), expect: ['tap-target'] },
  'tap-checkbox-labelled': { html: page({ main: '<label style="display:flex;min-height:44px;align-items:center;gap:12px"><input type="checkbox" style="width:24px;height:24px;margin:0"> Race-week edition</label>' }), expect: [] },
  // The design preview of the site footer is the footer index (secondary navigation), not a primary control.
  'footer-preview': { html: page({ main: '<div data-shell="footer-preview"><nav aria-label="Footer (preview)"><a href="/clean2" style="display:inline-flex;width:40px;min-height:44px">About</a></nav></div>' }), expect: [] },
  'hidden-reveal': { html: page({ main: '<section><div style="visibility:hidden"><h2>Championship standings after round 18</h2></div></section>' }), expect: ['hidden-content'] },
  axe: { html: page({ main: '<button style="min-width:44px;min-height:44px"></button><p style="color:#bbb;background:#fff">Low contrast race summary text for readers.</p>' }), expect: ['axe'] },
  gantry: { html: page({ main: '<div class="lights" style="display:flex;gap:8px">' + '<span style="display:block;width:24px;height:24px;border-radius:50%;background:red"></span>'.repeat(5) + '</div>' }), expect: ['forbidden'] },
  'github-link': { html: page({ main: '<p>Code on <a href="https://github.com/ShAuRyA-Noodle/apex">GitHub</a> for readers.</p>' }), expect: ['forbidden'] },
  // Third-party credit links to github.com are allowed (only the owner's accounts are forbidden).
  'github-credit': { html: page({ main: '<p>Circuit outlines from <a href="https://github.com/bacinger/f1-circuits">f1-circuits</a>, used under their licence.</p>' }), expect: [] },
  'footer-socials': { html: page({ footer: '<footer><a href="https://www.instagram.com/snappy_leader/">Instagram</a><a href="https://www.linkedin.com/in/shaurya-punj-2287513b3/">LinkedIn</a></footer>' }), expect: ['forbidden'] },
  'footer-credit': { html: page({ footer: page().match(/<footer>[\s\S]*<\/footer>/)[0].replace('</footer>', '<p>Apex is not affiliated with Formula 1.</p></footer>') }), expect: ['forbidden'] },
  caption: { html: page({ main: '<figure><img src="/pixel.png" alt="Car" width="100" height="100"><figcaption>Photo: Wikimedia Commons</figcaption></figure>' }), expect: ['forbidden'] },
  'provider-copy': { html: page({ main: '<p>Every result is data checked against Jolpica.</p>' }), expect: ['forbidden'] },
  stock: { html: page({ main: '<img src="/unsplash.com/photo.png" alt="Mood" width="100" height="100">' }), expect: ['forbidden'] },
  // History fixtures: a menu whose open state is restored from sessionStorage (reopens on Back), and its fixed twin.
  'reopen-menu': { html: menuPage(true), expect: ['history'] },
  'menu-fixed': { html: menuPage(false), expect: [] },
  'sticky-search': { html: searchPage(true), expect: ['history'] },
  'search-fixed': { html: searchPage(false), expect: [] },
  // Keyboard: a menu in a plain div (no focus containment, Escape ignored) and its native-dialog twin.
  'kb-broken': { html: kbPage(false), expect: ['keyboard'] },
  'kb-good': { html: kbPage(true), expect: [] },
  // Gate timing: the header arrives as a streamed Suspense boundary revealed after 'load' (React 19.2 batches
  // reveals). Tabbing must start on the delivered page, so this good menu must pass; kb-broken must still fail.
  'kb-late': { html: kbLatePage(), expect: [] },
  // Tabs by keyboard: ArrowRight ignored (focus stays on the first, still selected tab: must fail), and a good
  // tablist that, like a React page, gets its handlers only after hydration (1.5 s after load) and commits the
  // selection 600 ms after moving focus (slow re-render): must pass once the gate waits for hydration.
  'tabs-broken': { html: tabsPage({ arrows: false }), expect: ['keyboard'] },
  'tabs-late': { html: tabsPage({ arrows: true }), expect: [] },
  // Keyboard search: a field that filters nothing on a page whose default list already names Leclerc, and its working twin.
  'kb-search-dead': { html: kbSearchPage(false), expect: ['keyboard'] },
  'kb-search-live': { html: kbSearchPage(true), expect: [] },
  'dead-link': { html: page({ main: '<p>See <a href="/does-not-exist">the archive</a> for older seasons.</p>' }), expect: ['links'] },
};

function menuPage(buggy) {
  return page({
    header: `<header data-shell="nav"><a href="/" style="display:inline-flex;min-width:44px;min-height:44px">Apex</a><a href="/support" style="display:inline-flex;min-width:44px;min-height:44px">Give back</a>
      <button aria-expanded="false" id="menu" style="min-width:44px;min-height:44px">Menu</button></header>
      <div role="dialog" id="site-menu" hidden><a href="/clean2" style="display:inline-flex;min-width:44px;min-height:44px">Results</a></div>`,
    script: `<script>
      const b=document.getElementById('menu'),m=document.getElementById('site-menu');
      const set=(o)=>{b.setAttribute('aria-expanded',String(o));m.hidden=!o;${buggy ? "sessionStorage.setItem('menu',o?'1':'0');" : ''}};
      b.onclick=()=>set(b.getAttribute('aria-expanded')!=='true');
      ${buggy ? "if(sessionStorage.getItem('menu')==='1')set(true);" : "addEventListener('pagehide',()=>set(false));"}
    </script>`,
  });
}

function kbPage(good) {
  const header = `<header data-shell="nav"><a href="/" style="display:inline-flex;min-width:44px;min-height:44px">Apex</a><a href="/support" style="display:inline-flex;min-width:44px;min-height:44px">Give back</a>
    <button aria-expanded="false" id="menu" style="min-width:44px;min-height:44px">Menu</button></header>`;
  const menu = good
    ? '<dialog id="m"><a href="/clean2">Results</a> <a href="/support">Give back</a> <button id="x">Close</button></dialog>'
    : '<div id="m" hidden><a href="/clean2">Results</a> <a href="/support">Give back</a></div>';
  const script = good
    ? "<script>const b=document.getElementById('menu'),m=document.getElementById('m');b.onclick=()=>{m.showModal();b.setAttribute('aria-expanded','true')};m.addEventListener('close',()=>{b.setAttribute('aria-expanded','false');b.focus()});document.getElementById('x').onclick=()=>m.close();</script>"
    : "<script>const b=document.getElementById('menu'),m=document.getElementById('m');b.onclick=()=>{m.hidden=!m.hidden;b.setAttribute('aria-expanded',String(!m.hidden))};</script>";
  return page({ header: header + menu, main: '<p><a href="/clean">One</a> <a href="/clean2">Two</a> <a href="/support">Three</a></p>', script });
}

/** The site header streamed in: a wordmark-only fallback first, the real header (good menu) revealed 700 ms after load, 30 links in main. */
function kbLatePage() {
  const fallback = '<!--$?--><template id="B:0"></template><div data-shell="nav" style="padding:8px"><a href="/" style="display:inline-flex;min-width:44px;min-height:44px">Apex</a></div><!--/$-->';
  const real = `<div hidden id="S:0"><header data-shell="nav"><a href="/" style="display:inline-flex;min-width:44px;min-height:44px">Apex</a><a href="/support" style="display:inline-flex;min-width:44px;min-height:44px">Give back</a>
    <button aria-expanded="false" id="menu" style="min-width:44px;min-height:44px">Menu</button></header>
    <dialog id="m"><a href="/clean2">Results</a> <a href="/support">Give back</a> <button id="x">Close</button></dialog></div>`;
  const links = Array.from({ length: 30 }, (_, i) => `<a href="/clean?${i}" style="display:inline-flex;min-width:44px;min-height:44px">Story ${i + 1}</a>`).join(' ');
  const script = `<script>addEventListener('load',()=>setTimeout(()=>{const t=document.getElementById('B:0'),s=document.getElementById('S:0');t.nextElementSibling.replaceWith(...s.childNodes);t.remove();s.remove();
    const b=document.getElementById('menu'),m=document.getElementById('m');b.onclick=()=>{m.showModal();b.setAttribute('aria-expanded','true')};m.addEventListener('close',()=>{b.setAttribute('aria-expanded','false');b.focus()});document.getElementById('x').onclick=()=>m.close();},700));</script>`;
  return page({ header: fallback, main: `<p>${links}</p>${real}`, script });
}

function tabsPage({ arrows }) {
  const tab = (id, on) => `<button role="tab" id="t-${id}" aria-selected="${on}" aria-controls="p-${id}" tabindex="${on ? 0 : -1}" style="min-width:44px;min-height:44px">${id}</button>`;
  return page({
    main: `<div role="tablist" aria-label="Sessions">${tab('Race', true)}${tab('Qualifying', false)}${tab('Pit stops', false)}</div>` +
      ['Race', 'Qualifying', 'Pit stops'].map((id, i) => `<div role="tabpanel" id="p-${id}" ${i ? 'hidden' : ''}><p>${id} classification for the United States Grand Prix.</p></div>`).join(''),
    // window.__next_f marks a React page; __reactProps$ on each tab appears when "hydration" attaches the handlers.
    script: `<script>
      window.__next_f = [];
      const tabs = [...document.querySelectorAll('[role=tab]')];
      const select = (n) => { tabs[n].focus(); setTimeout(() => tabs.forEach((t, i) => { t.setAttribute('aria-selected', String(i === n)); t.tabIndex = i === n ? 0 : -1; document.getElementById(t.getAttribute('aria-controls')).hidden = i !== n; }), 600); };
      addEventListener('load', () => setTimeout(() => tabs.forEach((t, i) => {
        t['__reactProps$fixture'] = {};
        t.onclick = () => select(i);
        ${arrows ? "t.onkeydown = (e) => { const m = { ArrowRight: i + 1, ArrowLeft: i - 1 }; if (e.key in m) { e.preventDefault(); select((m[e.key] + tabs.length) % tabs.length); } };" : ''}
      }), 1500));
    </script>`,
  });
}

function kbSearchPage(live) {
  const rows = ['Andrea Kimi Antonelli', 'George Russell', 'Charles Leclerc', 'Max Verstappen'].map((n) => `<li><a href="/clean2" style="display:inline-flex;min-height:44px">${n}</a></li>`).join('');
  return page({
    main: `<form role="search" onsubmit="return false"><label for="q">Search drivers</label> <input type="search" id="q"></form><ul id="r">${rows}</ul>`,
    script: live ? "<script>const q=document.getElementById('q');q.addEventListener('input',()=>{for(const li of document.querySelectorAll('#r li'))li.hidden=!li.textContent.toLowerCase().includes(q.value.toLowerCase())});</script>" : '',
  });
}

function searchPage(buggy) {
  return page({
    main: '<input type="search" id="q" aria-label="Filter drivers">',
    // unload listener: no back/forward cache, like a client-rendered app that re-mounts on Back.
    script: `<script>
      addEventListener('unload',()=>{});
      const q=document.getElementById('q');
      ${buggy ? "addEventListener('load',()=>setTimeout(()=>{const s=sessionStorage.getItem('q'); if(s) q.value=s;},50)); q.addEventListener('input',()=>{ if(q.value) sessionStorage.setItem('q',q.value); });" : "const u=new URL(location.href); q.value=u.searchParams.get('q')??''; q.addEventListener('input',()=>{ const n=new URL(location.href); if(q.value) n.searchParams.set('q',q.value); else n.searchParams.delete('q'); history.replaceState(null,'',n); });"}
    </script>`,
  });
}

export function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname.replace(/^\//, '') || 'clean';
    if (path.endsWith('.png') && !path.includes('missing')) {
      if (path === 'tall.png') {
        // A real 100x400 PNG (portrait photo proportions), generated once.
        res.writeHead(200, { 'content-type': 'image/png' }); res.end(TALL_PNG); return;
      }
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(PIXEL); return;
    }
    const v = VARIANTS[path];
    if (!v) { res.writeHead(404, { 'content-type': 'text/html' }); res.end(page({ main: '<p>Not found on this fixture server.</p>' })); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(v.html);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

import zlib from 'node:zlib';
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function makePng(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 128); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TALL_PNG = makePng(100, 400);
