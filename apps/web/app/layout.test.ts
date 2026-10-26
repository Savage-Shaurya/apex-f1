import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BRAND_STATEMENT, DATA_CREDITS, IMAGE_CREDITS, NON_AFFILIATION_STATEMENT } from '../lib/credits';
import { SOCIAL_LINKS } from '../components/ds/shell/social';
import { ShellBody } from './shell-body';
import { rootMetadata } from './root-metadata';
import { ConsentBanner } from '../components/ds/shell/ConsentBanner';
import { SiteFooter } from '../components/ds/shell/SiteFooter';
import { SiteMenu } from '../components/ds/shell/SiteMenu';
import { SiteFooterServer, SiteHeaderServer } from '../components/ds/shell/server';
import { isSearchShortcut, navSections } from '../components/ds/shell/nav-config';

// Components here compile with the classic JSX runtime under tsx.
(globalThis as { React?: unknown }).React = React;
const here = path.dirname(fileURLToPath(import.meta.url));
// globals.css is the product's stylesheet: its declared values are what browsers apply.
const globals = readFileSync(path.resolve(here, 'globals.css'), 'utf8');
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');

/** Depth-first list of the elements a component returns (no rendering of async server children). */
function elements(node: React.ReactNode, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) { for (const child of node) elements(child, out); return out; }
  if (!React.isValidElement(node)) return out;
  out.push(node);
  elements((node.props as { children?: React.ReactNode }).children, out);
  return out;
}

test('the shell renders skip link, consent banner, header, main (offset below the header) and footer, in that order', () => {
  // The banner exists only with an analytics provider configured (F-12; its absence otherwise is tested in consent-gating.test.ts).
  const previousKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_public_test_key';
  const marker = React.createElement('p', { id: 'page-content' }, 'page');
  let tree: React.ReactElement[];
  try { tree = elements(ShellBody({ children: marker })); } finally {
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY; else process.env.NEXT_PUBLIC_POSTHOG_KEY = previousKey;
  }
  const at = (match: (el: React.ReactElement) => boolean) => tree.findIndex(match);
  const props = (el: React.ReactElement) => el.props as Record<string, unknown>;
  const skip = at((el) => el.type === 'a' && props(el).href === '#main');
  const banner = at((el) => el.type === ConsentBanner);
  const header = at((el) => el.type === SiteHeaderServer);
  const main = at((el) => el.type === 'main');
  const content = at((el) => el === marker);
  const footer = at((el) => el.type === SiteFooterServer);
  assert.ok(skip >= 0 && skip < banner && banner < header && header < main && main < content && content < footer, `order ${[skip, banner, header, main, content, footer]}`);
  assert.equal(tree.filter((el) => el.type === ConsentBanner).length, 1, 'banner rendered once');
  assert.match(String(props(tree[main]!).className), /pt-\[var\(--shell-h\)\]/);
  for (const file of ['SiteNav.tsx', 'SiteNavServer.tsx', 'Footer.tsx', 'FooterServer.tsx', 'CookieConsent.tsx', 'FooterCredits.tsx']) {
    assert.ok(!existsSync(path.resolve(here, '../components/shell', file)), `old shell file ${file} is deleted`);
  }
});

test('the footer carries the brand line, the socials and Give back, and no credits or non-affiliation line (those live on /references)', () => {
  assert.ok(IMAGE_CREDITS.some((c) => /formula1\.com/.test(c.role) || /F1 media/.test(c.name)), 'F1 media credited (on /references)');
  const html = renderToStaticMarkup(React.createElement(SiteFooter, { season: 2026, statement: BRAND_STATEMENT }));
  assert.ok(html.includes('Apex is an independent, fan'), 'brand statement shown');
  assert.doesNotMatch(html, /Not affiliated|not affiliated/, 'no non-affiliation line in the footer');
  assert.ok(!html.includes(NON_AFFILIATION_STATEMENT.slice(0, 40)));
  for (const credit of [...IMAGE_CREDITS, ...DATA_CREDITS]) assert.ok(!html.includes(`>${credit.name.replace(/&/g, '&amp;')}<`), `footer does not list the credit ${credit.name}`);
  assert.doesNotMatch(html, /github/i, 'no GitHub anywhere in the footer');
  const socialHrefs = [...html.matchAll(/<ul aria-label="Follow Apex"[\s\S]*?<\/ul>/g)].flatMap((m) => [...m[0].matchAll(/href="([^"]+)"/g)].map((h) => h[1]));
  assert.deepEqual(socialHrefs, SOCIAL_LINKS.map((s) => s.href), 'socials exactly as in social.ts');
  assert.match(html, /href="\/support"/, 'Give back card links to /support');
  // An unconfirmed standings season never becomes a guessed Results link (R3-REG-1).
  const outage = renderToStaticMarkup(React.createElement(SiteFooter, { season: null }));
  assert.match(outage, /href="\/results\/archive"/);
  assert.doesNotMatch(outage, /href="\/results\/\d{4}\//);
  const refs = read('references/page.tsx');
  assert.match(refs, /NON_AFFILIATION_STATEMENT/, '/references states non-affiliation');
  assert.match(refs, /REFERENCE_GROUPS/, '/references is built from lib/credits.ts');
});

test('no global style tracks text negative, and every hand-set negative utility is neutralised', () => {
  const negatives = [...globals.matchAll(/letter-spacing:\s*(-[\d.]+)em/g)].map((m) => m[1]);
  assert.deepEqual(negatives, [], 'globals.css declares no negative letter-spacing');
  for (const token of ['--tracking-tight', '--tracking-tighter']) {
    const value = Number(globals.match(new RegExp(`${token}:\\s*(-?[\\d.]+)em`))?.[1]);
    assert.ok(value >= 0, `${token} is not negative`);
  }
  const guard = globals.match(/:is\(\[class\*='tracking-\[-'\][^{]*\)\s*:not\(\[class\*='text-display-'\]\)\s*\{\s*letter-spacing:\s*0em;/);
  assert.ok(guard, 'site-wide guard resets negative tracking utilities (ds display headings exempt)');
});

test('the home page is the Carbon & Light home, with no gantry and no old home pieces', () => {
  // Style policy (negative tracking, CSS clipping, clock seasons) is enforced by ESLint for components/brand-c (R3-CODE-10).
  const page = read('page.tsx');
  assert.doesNotMatch(page, /race-desk|StartLights|components\/home\/(Ignition|HomeNews|LastRace)/);
  assert.match(page, /loadBrandC\(\)/, 'real data loader');
  assert.ok(!existsSync(path.resolve(here, '../components/home/race-desk')), 'old race-desk folder removed');
  assert.ok(!existsSync(path.resolve(here, '../components/home/IgnitionView.tsx')), 'old gantry home removed');
  for (const file of ['Hero.tsx', 'HeadlineTicker.tsx', 'RaceWeekend.tsx', 'Championship.tsx', 'TimingTower.tsx', 'StudioCard.tsx', 'SeasonRail.tsx', 'GiveBack.tsx', 'live.tsx']) {
    assert.doesNotMatch(read(`../components/brand-c/${file}`), /StartLights|data-lenis-prevent/, `${file} has no gantry and no wheel dead zone`);
  }
});

test('the 404 page is Carbon & Light type with a 404 title, three real ways back and the real next race, with no gantry', () => {
  // Source-level: not-found.tsx imports the Carbon & Light stylesheet, which the unit-test loader cannot import.
  const page = read('not-found.tsx');
  assert.match(page, /title: '404: Out of session'/);
  assert.match(page, /import '@\/components\/brand-c\/brand-c\.css'/);
  assert.match(page, /className="bc /);
  assert.match(page, /className="bc-display/);
  for (const href of ['/schedule', '/latest', '/']) assert.match(page, new RegExp(`href: '${href}'`));
  assert.match(page, /getShellCalendar\(\)\.catch\(\(\) => null\)/, 'next race comes from the cached calendar and an outage never breaks the 404');
  assert.match(page, /<Countdown iso=\{next\.raceStartIso\}/);
  assert.doesNotMatch(page, /StartLights|gantry/i);
});

test('the error page is Carbon & Light type with a retry and a way home, with no gantry, and a provider outage gets the honest unavailable copy', () => {
  const page = read('error.tsx');
  assert.match(page, /className="bc /);
  assert.match(page, /onClick=\{\(\) => retry\(\)\}/);
  assert.match(page, /href="\/"/);
  assert.match(page, /isProviderOutageDigest\(error\.digest\)/);
  assert.doesNotMatch(page, /StartLights|gantry/i);
});

test('the header shows scroll position as one red line', () => {
  const header = read('../components/ds/shell/SiteHeader.tsx');
  assert.match(header, /<ScrollProgress /);
  assert.doesNotMatch(header, /StartLights/);
});

test('the header bar is in the first HTML: not behind a Suspense fallback, and its server wrapper does not wait for reads', () => {
  // A suspended (or large, outlined) header boundary was revealed after 'load': the keyboard path
  // went Skip -> wordmark -> page, missing Give back, Search and Menu (gate keyboard check).
  const tree = elements(ShellBody({ children: null }));
  const wrapped = tree.filter((el) => el.type === React.Suspense).some((s) => elements((s.props as { children?: React.ReactNode }).children).some((el) => el.type === SiteHeaderServer));
  assert.ok(!wrapped, 'SiteHeaderServer is not inside a Suspense boundary');
  assert.ok(tree.some((el) => el.type === SiteHeaderServer), 'header rendered');
  assert.doesNotMatch(read('../components/ds/shell/server.tsx'), /export async function SiteHeaderServer/);
});

test('focus scrolls clear of the consent banner and the fixed header', () => {
  assert.match(globals, /scroll-padding-bottom:\s*calc\(var\(--consent-h, 0px\)/);
  assert.match(globals, /scroll-padding-top:\s*calc\(var\(--shell-h\)/);
});

test('root metadata makes no live-timing promise and sets no robots that would contradict a 404 noindex', () => {
  assert.equal(rootMetadata.robots, undefined);
  const text = JSON.stringify(rootMetadata);
  assert.doesNotMatch(text, /live race-day|live timing/i);
});

test('the shell has no single-key shortcut and every menu section is keyboard-expandable at every width', () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => isSearchShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });
  assert.equal(key('/'), false, 'no bare "/" shortcut (WCAG 2.1.4)');
  assert.equal(key('k'), false);
  assert.equal(key('k', { ctrlKey: true }), true);
  assert.equal(key('K', { metaKey: true }), true);
  assert.equal(key('k', { ctrlKey: true, altKey: true }), false);
  const html = renderToStaticMarkup(React.createElement(SiteMenu, { sections: navSections({ calendar: 2026, results: 2026 }), active: undefined, lead: null, nextRace: null, onClose: () => {} } as never));
  const toggles = [...html.matchAll(/<button[^>]*aria-controls="menu-links-\d+"[^>]*>/g)].map((m) => m[0]);
  assert.ok(toggles.length >= 5, 'each section has a disclosure button');
  for (const toggle of toggles) assert.doesNotMatch(toggle, /\blg:hidden\b/, 'the disclosure is not hidden on desktop');
  for (const list of html.matchAll(/<[a-z]+[^>]*id="menu-links-\d+"[^>]*>/g)) assert.doesNotMatch(list[0], /lg:hidden/, 'expanded links show on desktop');
});

test('circuit outlines (bacinger/f1-circuits, MIT) are credited in the data credits on /references', () => {
  const outline = DATA_CREDITS.find((c) => /bacinger\/f1-circuits/.test(c.name));
  assert.ok(outline, 'credited');
  assert.equal(outline?.license?.name, 'MIT');
});

test('no complementary landmark is nested inside <main> (every page renders inside it): side panels are sections or groups', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (name.endsWith('.tsx') && !name.includes('.test.') && /<aside\b|role="complementary"/.test(readFileSync(file, 'utf8'))) offenders.push(path.relative(here, file));
    }
  };
  walk(here);
  walk(path.resolve(here, '../components'));
  assert.deepEqual(offenders, []);
});

test('every route error screen names the browser tab (a thrown outage skips generateMetadata; axe document-title)', () => {
  for (const file of ['error.tsx', 'schedule/[season]/[race]/error.tsx', '../components/drivers/DriverPageError.tsx', '../components/teams/TeamError.tsx']) {
    assert.match(read(file), /<title>/, `${file} renders a <title>`);
  }
});
