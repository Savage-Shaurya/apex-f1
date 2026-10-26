/**
 * Forbidden patterns (static) and the gate's pure comparison helpers.
 *
 * Each rule is proved twice: it CATCHES a deliberately broken sample, and it
 * stays quiet on the legitimate look-alike. Then the whole apps/web source
 * tree is scanned: any violation fails `pnpm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOOTER_SOCIALS, scanRendered, scanSource } from './lib/forbidden.mjs';
import { scanRepo } from './lib/static-scan.mjs';
import { compareOrderedRows, latestTeams } from './lib/data-truth.mjs';

const rulesHit = (text, file = 'components/x/Thing.tsx') => scanSource(text, file).map((h) => h.rule);

test('gantry: a five-light start gantry component is caught', () => {
  assert.deepEqual(rulesHit('export function StartLights() { return <div className="gantry" /> }'), ['gantry', 'gantry']);
  assert.deepEqual(rulesHit('export function RaceHero() { return <div className="hero" /> }'), []);
});

test('dots: decorative dot classes and dot-grid backgrounds are caught', () => {
  assert.deepEqual(rulesHit('<span className="live-dot bg-red" />'), ['dots']);
  assert.deepEqual(rulesHit('.bg-dots { background: red }', 'components/x/a.css'), ['dots']);
  assert.deepEqual(rulesHit('.grid { background: radial-gradient(circle, #fff 1px, transparent 1px) 0 0 / 12px 12px }', 'components/x/a.css'), ['dots']);
  assert.deepEqual(rulesHit('<span className="rounded-full bg-red size-2" aria-hidden />'), []);
});

test('cursor: custom cursors are caught', () => {
  assert.deepEqual(rulesHit('body { cursor: none; }', 'app/globals.css'), ['cursor']);
  assert.deepEqual(rulesHit('<CustomCursor />'), ['cursor']);
  assert.deepEqual(rulesHit('button { cursor: pointer; }', 'app/globals.css'), []);
});

test("github: the owner's GitHub (link or handle) is caught anywhere; third-party credit links are allowed", () => {
  assert.deepEqual(rulesHit('<a href="https://github.com/ShAuRyA-Noodle/Apex-F1">Code</a>'), ['github']);
  assert.deepEqual(rulesHit('<a href="https://github.com/savage-shaurya">Code</a>'), ['github'], 'case-insensitive');
  assert.deepEqual(rulesHit("export const APEX_REPOSITORY_URL = 'https://github.com/ShAuRyA-Noodle/Apex-F1';", 'packages-like/user-agent.ts'), ['github']);
  assert.deepEqual(rulesHit('{"author": "Savage-Shaurya"}', 'lib/data/x.json'), ['github']);
  // Owner 2026-10-26 (clarified): open-source, data and font credits on /references may link to github.com.
  assert.deepEqual(rulesHit("href: 'https://github.com/bacinger/f1-circuits'", 'lib/credits.ts'), []);
  assert.deepEqual(rulesHit('<a href="https://github.com/jolpica/jolpica-f1">Jolpica</a>', 'app/references/page.tsx'), []);
});

test('stock media: Unsplash, Giphy and placeholder images are caught', () => {
  assert.deepEqual(rulesHit('<img src="https://images.unsplash.com/photo-1" />'), ['stock-media']);
  assert.deepEqual(rulesHit('const gif = "https://media.giphy.com/media/abc/giphy.gif"'), ['stock-media']);
  assert.deepEqual(rulesHit('<img src="/img/placeholder.png" />'), ['stock-media']);
  assert.deepEqual(rulesHit('<input placeholder="Search drivers" />'), []);
});

test('old contact values are caught', () => {
  assert.deepEqual(rulesHit("const email = 'workwithshaurya10@gmail.com';"), ['old-contact']);
  assert.deepEqual(rulesHit("href: 'https://www.linkedin.com/in/shaurya-punj-2287513b3/'"), ['old-contact']);
  assert.deepEqual(rulesHit("href: 'https://x.com/ShAuRyANoodle'"), ['old-contact']);
});

test('lorem: filler text is caught', () => {
  assert.deepEqual(rulesHit('<p>Lorem ipsum dolor sit amet</p>'), ['lorem']);
});

test('provider copy: provider names and pipeline mechanics in visible copy are caught outside /references and /legal', () => {
  assert.deepEqual(rulesHit('<p>Results are data checked against Jolpica every hour.</p>'), ['provider-copy']);
  assert.deepEqual(rulesHit('<p>Live timing comes from the OpenF1 feed.</p>'), ['provider-copy']);
  assert.deepEqual(rulesHit('<p>Data from Jolpica.</p>', 'app/references/page.tsx'), []);
  assert.deepEqual(rulesHit("import { jolpica } from '@apex/api-client';\nconst x = await jolpica.getSchedule(2026);"), []);
  assert.deepEqual(rulesHit('<p>Lando Norris won the race from pole.</p>'), []);
});

const cleanFacts = {
  mainText: 'Lando Norris won the United States Grand Prix.',
  bodyText: 'Lando Norris won the United States Grand Prix.',
  imageSources: ['https://media.formula1.com/image/upload/a.jpg'],
  links: ['https://apex.test/drivers'],
  footerLinks: [...FOOTER_SOCIALS, 'https://apex.test/support'],
  footerText: 'Apex. Built by Shaurya Punj. Give back.',
  captions: [],
  html: '<html><body>Lando Norris</body></html>',
  cursorNone: null,
  gantry: null,
};

test('rendered: a clean page passes and each injected problem is caught', () => {
  assert.deepEqual(scanRendered(cleanFacts, '/'), []);
  const cases = [
    [{ mainText: 'Times checked against Jolpica.' }, /provider copy/],
    [{ bodyText: 'lorem ipsum' }, /lorem/],
    [{ imageSources: ['https://images.unsplash.com/photo-1'] }, /stock/],
    [{ links: ['https://github.com/Savage-Shaurya'] }, /owner GitHub link/],
    [{ bodyText: 'Code by ShAuRyA-Noodle' }, /owner GitHub handle/],
    [{ gantry: 'div.lights (5 round empty children)' }, /gantry/],
    [{ cursorNone: 'body' }, /custom cursor/],
    [{ footerLinks: ['https://www.instagram.com/snappy_leader/'] }, /footer socials missing or changed: https:\/\/x\.com\/SnappyLeader, https:\/\/www\.linkedin\.com\/in\/shaurya-punj-86a3b4444\/, mailto:shaurya@snappycrew\.com/],
    [{ footerLinks: FOOTER_SOCIALS.map((h) => h.replace('86a3b4444', '2287513b3')) }, /footer socials missing or changed: https:\/\/www\.linkedin/],
    [{ links: ['https://github.com/ShAuRyA-Noodle/Apex-F1'] }, /owner GitHub link/, '/references'],
    [{ footerText: 'Apex is not affiliated with Formula 1.' }, /credit\/licence text in the footer/],
    [{ footerText: 'Data CC BY-NC-SA 4.0' }, /credit\/licence text in the footer/],
    [{ captions: ['Photo: Wikimedia Commons'] }, /credit caption outside \/references/],
    [{ captions: ['Outline: bacinger/f1-circuits'] }, /credit caption/],
    [{ html: '<a href="mailto:workwithshaurya10@gmail.com">' }, /retired contact value on the page: workwithshaurya10@gmail\.com/],
    [{ html: 'https://x.com/ShAuRyANoodle' }, /retired contact value/],
    [{ footerLinks: [] }, /footer missing/],
  ];
  for (const [patch, expected, route = '/'] of cases) {
    const found = scanRendered({ ...cleanFacts, ...patch }, route);
    assert.ok(found.some((f) => expected.test(f.detail)), `expected ${expected} for ${JSON.stringify(patch)}, got ${JSON.stringify(found)}`);
  }
  assert.deepEqual(scanRendered({ ...cleanFacts, mainText: 'Data: Jolpica (CC BY-NC-SA)', captions: ['Data: Jolpica'] }, '/references'), []);
  // Third-party credit links to github.com are allowed on /references and elsewhere; only the owner's accounts are not.
  assert.deepEqual(scanRendered({ ...cleanFacts, links: ['https://github.com/jolpica/jolpica-f1', 'https://github.com/bacinger/f1-circuits'] }, '/references'), []);
});

test('data truth: row comparison catches missing, reordered and wrong-points rows', () => {
  const expected = [{ key: 'Norris', mustContain: ['390'] }, { key: 'Piastri', mustContain: ['366'] }];
  assert.deepEqual(compareOrderedRows(expected, ['1 Lando Norris McLaren 390', '2 Oscar Piastri McLaren 366']), []);
  assert.match(compareOrderedRows(expected, ['1 Oscar Piastri 366', '2 Lando Norris 390'], { label: 'P' }).join(), /out of order/);
  assert.match(compareOrderedRows(expected, ['1 Lando Norris 390']).join(), /"Piastri" not shown/);
  assert.match(compareOrderedRows([{ key: 'Norris' }, { key: 'Piastri' }], ['P', 'x']).join(), /none of the expected/);
  assert.match(compareOrderedRows(expected, ['1 Lando Norris 391', '2 Oscar Piastri 366']).join(), /expected 390/);
  // A chart data-table header naming every team does not hide the real row, and a page with no rows is called out.
  assert.deepEqual(compareOrderedRows([{ key: 'Mercedes', mustContain: ['607'] }], ['RoundMercedesFerrariMcLaren', '1 Mercedes Antonelli, Russell 12 607']), []);
  assert.match(compareOrderedRows(expected, ['Loading the championship table']).join(), /none of the expected entries is shown/);
  // Accents and 0.5-point totals.
  assert.deepEqual(compareOrderedRows([{ key: 'Pérez', mustContain: ['12.5'] }], ['9 Sergio Perez 12.5']), []);
});

test('data truth: the latest team wins for a driver who moved mid-season', () => {
  const race = (round, team) => ({ round: String(round), Results: [{ Driver: { driverId: 'lawson' }, Constructor: { constructorId: team, name: team } }] });
  const { latest, moved } = latestTeams([race(3, 'rb'), race(1, 'red_bull'), race(2, 'red_bull')]);
  assert.equal(latest.get('lawson').constructorId, 'rb');
  assert.deepEqual(moved, ['lawson']);
});

test('apps/web source has no forbidden patterns', async () => {
  const { files, hits } = await scanRepo();
  assert.ok(files > 100, `scanned ${files} files`);
  assert.deepEqual(hits.map((h) => `${h.rule} ${h.file}:${h.line} ${h.match}`), []);
});

test('links: a connection reset is retried once; a link that fails twice or answers an HTTP error is still reported', async () => {
  const { checkExternal } = await import('./lib/flows.mjs');
  const reset = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
  const noWait = async () => {};
  // Reset on HEAD and the first GET, fine on the retry: not a dead link.
  let calls = 0;
  const flaky = () => (++calls < 3 ? reset() : Promise.resolve({ status: 200 }));
  assert.equal((await checkExternal('https://commons.wikimedia.org/wiki/File:x.jpg', { fetchImpl: flaky, sleep: noWait })).status, 200);
  assert.equal(calls, 3);
  // Always resetting: reported (status 0).
  assert.equal((await checkExternal('https://example.invalid/', { fetchImpl: reset, sleep: noWait })).status, 0);
  // An HTTP 404 on HEAD and GET is final, no extra retry.
  calls = 0;
  const gone = () => { calls++; return Promise.resolve({ status: 404 }); };
  assert.equal((await checkExternal('https://example.com/gone', { fetchImpl: gone, sleep: noWait })).status, 404);
  assert.equal(calls, 2);
});
