import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { colors, colorCssVar } from '@apex/ui/tokens';
import { cn } from '@apex/ui';
import { contrastRatio, isPerceivableMark, normalizeHex, readableInkOn, readableTeamText, teamField } from './color';
import { FIT_TOLERANCE, MEDIA_RULES, parseRatio, resolveFit } from './media-rules';
import { CAPS_TRACKING, SENTENCE_TRACKING } from './Type';
import { trimSummary } from './text';
import { activeSection, footerGroups, GIVE_BACK_LABEL, legalLinks, navSections, searchSeasonSuggestions } from './shell/nav-config';
import { SOCIAL_LINKS } from './shell/social';

const here = path.dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(path.resolve(here, '../../app/globals.css'), 'utf8');
const tokensCss = readFileSync(path.resolve(here, '../../../../packages/ui/src/tokens.css'), 'utf8');

function cssValue(source: string, variable: string): string | null {
  const match = source.match(new RegExp(`${variable.replace(/[-]/g, '\\-')}:\\s*([^;]+);`));
  return match ? match[1]!.trim().toLowerCase() : null;
}

test('every JS colour token matches its @theme value in globals.css', () => {
  for (const [key, hex] of Object.entries(colors)) {
    const variable = colorCssVar[key as keyof typeof colors];
    assert.equal(cssValue(globals, variable), hex.toLowerCase(), `${key} -> ${variable}`);
  }
});

test('the plain-CSS token mirror agrees with the JS tokens where it declares a colour', () => {
  for (const [key, hex] of Object.entries(colors)) {
    const value = cssValue(tokensCss, colorCssVar[key as keyof typeof colors]);
    if (value) assert.equal(value, hex.toLowerCase(), key);
  }
});

test('text tokens meet WCAG AA on the surfaces they are allowed on', () => {
  const aa = (fg: string, bg: string) => contrastRatio(fg, bg) >= 4.5;
  for (const bg of [colors.ground, colors.surface1, colors.surface2, colors.surface3, colors.surface4]) {
    assert.ok(aa(colors.ink, bg) && aa(colors.ink2, bg) && aa(colors.ink3, bg), `ink steps on ${bg}`);
  }
  for (const bg of [colors.ground, colors.surface1, colors.surface2, colors.surface3]) assert.ok(aa(colors.redInk, bg), `red ink on ${bg}`);
  for (const bg of [colors.paper, colors.paper2, colors.paper3]) {
    assert.ok(aa(colors.paperInk2, bg) && aa(colors.paperInk3, bg) && aa(colors.redInkPaper, bg), `paper inks on ${bg}`);
  }
  assert.ok(aa('#ffffff', colors.brandRed), 'white on brand red');
  assert.ok(aa('#ffffff', colors.brandRedHover), 'white on hover red');
  assert.ok(contrastRatio(colors.brandRed, colors.ground) < 4.5, 'brand red is a surface, not small text on carbon');
});

test('normalizeHex accepts OpenF1 team_colour forms and rejects junk', () => {
  assert.equal(normalizeHex('3671C6'), '#3671c6');
  assert.equal(normalizeHex('#36c'), '#3366cc');
  assert.equal(normalizeHex('blue'), null);
  assert.equal(normalizeHex(undefined), null);
});

test('readableTeamText always reaches AA and keeps colours that already pass', () => {
  for (const team of ['#3671c6', '#27f4d2', '#e8002d', '#ff8000', '#229971', '#0093cc', '#64c4ff', '#b6babd', '#52e252', '#000000', '#1868db']) {
    const onCarbon = readableTeamText(team, colors.ground);
    assert.ok(contrastRatio(onCarbon, colors.ground) >= 4.5, `${team} on carbon -> ${onCarbon}`);
    const onPaper = readableTeamText(team, colors.paper);
    assert.ok(contrastRatio(onPaper, colors.paper) >= 4.5, `${team} on paper -> ${onPaper}`);
  }
  assert.equal(readableTeamText('#ff8000', colors.ground), '#ff8000');
  assert.equal(readableInkOn('#ffd60a'), '#0b0b0c');
  assert.equal(readableInkOn('#3671c6'), '#ffffff');
  assert.equal(teamField(null), '#17171a');
  assert.ok(isPerceivableMark('#e10600'));
});

test('media rules never crop headshots, logos, cars or circuits', () => {
  for (const kind of ['headshot', 'logo', 'car', 'circuit'] as const) {
    assert.equal(resolveFit(MEDIA_RULES[kind], { width: 4000, height: 1000 }), 'contain', kind);
  }
});

test('photographs cover only when the crop is small, otherwise contain', () => {
  const wide = MEDIA_RULES.wide;
  assert.equal(resolveFit(wide, null), 'cover');
  assert.equal(resolveFit(wide, { width: 1920, height: 1080 }), 'cover');
  assert.equal(resolveFit(wide, { width: 1500, height: 1000 }), 'cover');
  assert.equal(resolveFit(wide, { width: 1000, height: 1000 }), 'contain');
  assert.equal(resolveFit(wide, { width: 800, height: 1200 }), 'contain');
  assert.ok(FIT_TOLERANCE <= 0.2);
  assert.equal(parseRatio('21 / 9').toFixed(3), (21 / 9).toFixed(3));
});

test('trimSummary shortens at a word boundary instead of clipping glyphs', () => {
  assert.equal(trimSummary('Short teaser.', 50), 'Short teaser.');
  const long = 'Either Red Bull driver could have been on pole for the United States Grand Prix were they not thwarted by Kimi Antonelli';
  const out = trimSummary(long, 60);
  assert.ok(out.endsWith('…') && out.length <= 61, out);
  assert.ok(!/\s…$/.test(out));
  assert.equal(trimSummary(null), '');
});

test('navigation keeps Give back in the main nav, is season-aware and identifies the active section', () => {
  const sections = navSections({ calendar: 2027, results: 2027 });
  const hrefs = sections.flatMap((s) => [s.href, ...s.links.map((l) => l.href)]).concat(footerGroups(2027).flatMap((g) => g.links.map((l) => l.href)), legalLinks().map((l) => l.href));
  const give = sections.find((s) => s.href === '/support');
  assert.ok(give?.primary && give.accent, 'Give back (/support) stays in the primary navigation with the accent');
  const footer = readFileSync(path.resolve(here, 'shell/SiteFooter.tsx'), 'utf8');
  assert.match(footer, /href="\/support"/, 'footer gives Give back its own prominent link');
  assert.ok(hrefs.includes('/references'), 'footer links References');
  assert.ok(!hrefs.includes('/drivers/hall-of-fame'), 'no duplicate Hall of Fame link (it redirects to champions)');
  assert.equal(activeSection(sections, '/support'), 'Give back');
  assert.ok(hrefs.includes('/results/2027/drivers'));
  assert.ok(!hrefs.some((h) => h.includes('2026')), 'no hard-coded season');
  assert.equal(activeSection(sections, '/results/2027/teams'), 'Results');
  assert.equal(activeSection(sections, '/drivers/max-verstappen'), 'Drivers');
  assert.equal(activeSection(sections, '/'), undefined);
});

test('Give back stays primary for every season state, and calendar labels never print a guessed year', () => {
  for (const seasons of [{ calendar: 2026, results: 2026 }, { calendar: null, results: 2026 }, { calendar: 2027, results: 2026 }]) {
    const sections = navSections(seasons);
    const give = sections.find((s) => s.href === '/support');
    assert.equal(give?.label, GIVE_BACK_LABEL);
    assert.ok(give?.primary, 'shown in the desktop bar');
    const schedule = sections.find((s) => s.label === 'Schedule')!;
    if (seasons.calendar === null) {
      assert.equal(schedule.links[0]!.label, 'Race calendar');
      assert.doesNotMatch(schedule.blurb, /\d{4}/);
    } else assert.equal(schedule.links[0]!.label, `${seasons.calendar} calendar`);
    assert.equal(sections.find((s) => s.label === 'Results')!.href, `/results/${seasons.results}/drivers`);
    assert.deepEqual(searchSeasonSuggestions(seasons).map((l) => l.href), [`/results/${seasons.results}/drivers`, `/results/${seasons.results}/teams`]);
  }
});

test('the footer is clean: brand line, owner socials (no GitHub), no credit blocks or maker block', () => {
  const footer = readFileSync(path.resolve(here, 'shell/SiteFooter.tsx'), 'utf8');
  assert.match(footer, /independent, fan-built Formula 1 platform/);
  for (const gone of [/Data and image credits/, /Designed, built and maintained/, /github\.com/i, /CreditList/]) assert.doesNotMatch(footer, gone);
  assert.deepEqual(SOCIAL_LINKS.map((s) => s.id), ['instagram', 'x', 'linkedin', 'email']);
  assert.ok(SOCIAL_LINKS.every((s) => !/github/i.test(s.href)), 'no GitHub');
  assert.equal(SOCIAL_LINKS.find((s) => s.id === 'email')?.href, 'mailto:shaurya@snappycrew.com');
  assert.ok(SOCIAL_LINKS.every((s) => s.accessibleName.startsWith(s.label)), 'each icon link has an accessible name');
  assert.ok(SOCIAL_LINKS.filter((s) => s.href.startsWith('http')).every((s) => /opens in a new tab/.test(s.accessibleName)));
});

test('cn keeps Apex type steps and font width classes (tailwind-merge config)', () => {
  assert.equal(cn('font-display text-display-xl font-semi-wide', 'text-fg'), 'font-display text-display-xl font-semi-wide text-fg');
  assert.equal(cn('text-small', 'text-caption'), 'text-caption');
  assert.equal(cn('text-fg', 'text-fg-2'), 'text-fg-2');
});

test('the design preview route is unreachable in production (R3-CODE-10: behaviour, not source text)', async () => {
  const { default: DesignPage, metadata } = await import('../../app/design/page');
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    await assert.rejects(DesignPage(), (error: { digest?: string }) => typeof error.digest === 'string' && error.digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404'));
  } finally { env.NODE_ENV = previous; }
  assert.deepEqual(metadata.robots, { index: false, follow: false });
});

/** Smallest rendered size of a type token in px (clamp minimum, or fixed rem). */
function minPx(value: string): number {
  const clamp = value.match(/clamp\(\s*([\d.]+)rem/);
  const rem = clamp ? clamp[1] : value.match(/^([\d.]+)rem$/)?.[1];
  return rem ? Number(rem) * 16 : Number.NaN;
}

test('no type step is tracked negative, and nothing under 24px can be', () => {
  const steps = [...globals.matchAll(/--text-([a-z-]+?)--letter-spacing:\s*(-?[\d.]+)em;/g)];
  assert.ok(steps.length >= 15, 'type scale found');
  const legacy = new Set(['mega', 'giant', 'huge', 'title']);
  for (const [, name, em] of steps) {
    const size = cssValue(globals, `--text-${name}`);
    const min = size ? minPx(size) : Number.NaN;
    if (legacy.has(name!)) {
      assert.ok(Number(em) >= -0.01, `legacy ${name} at most -0.01em`);
      assert.ok(min >= 24, `legacy ${name} only tightens above 24px`);
      continue;
    }
    assert.ok(Number(em) >= 0, `${name} tracking ${em}em must not be negative`);
  }
});

test('display capitals open slightly; sentence-case display closes only above 48px and by at most 0.008em', () => {
  for (const cls of Object.values(CAPS_TRACKING)) {
    const em = Number(cls!.match(/tracking-\[(-?[\d.]+)em\]/)![1]);
    assert.ok(em >= 0 && em <= 0.005, cls);
  }
  for (const cls of Object.values(SENTENCE_TRACKING)) {
    assert.match(cls!, /^(md|lg|xl):tracking-\[-0\.00[0-8]em\]$/, cls);
  }
});

// Hand-set negative tracking in ds/shell/home sources is an ESLint rule (eslint.config.mjs, R3-CODE-10).

test('the light loader announces a real message and runs one transform-only streak that rests under reduced motion', () => {
  const loader = readFileSync(path.resolve(here, 'LightLoader.tsx'), 'utf8');
  assert.match(loader, /role="status"/);
  assert.match(loader, /\{message\}/);
  assert.match(loader, /aria-hidden className="ds-light-track"/, 'the track is decorative; the message is the announcement');
  const streak = globals.slice(globals.indexOf('.ds-light-track'), globals.indexOf('@keyframes ds-light-run'));
  assert.match(streak, /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.ds-light-streak \{[^}]*animation: ds-light-run/, 'animates only when motion is allowed');
  const keyframes = globals.match(/@keyframes ds-light-run \{([^\n]+)\}/)?.[1] ?? '';
  assert.ok(keyframes.length > 0 && !/(left|width|inset|margin)\s*:/.test(keyframes), 'transform only');
});

test('scroll progress is one line scaled on the transform from ScrollTrigger, with no state per frame', () => {
  const progress = readFileSync(path.resolve(here, 'ScrollProgress.tsx'), 'utf8');
  assert.match(progress, /useScrollProgress\(/);
  assert.match(progress, /el\.style\.transform = `scaleX\(/);
  assert.doesNotMatch(progress, /useState|requestAnimationFrame/);
  assert.match(progress, /origin-left bg-brand-red/);
});

test('red keeps one meaning: a highlighted (leader) row keeps its team stripe and gets a red top rule, never a red stripe', async () => {
  const React = await import('react');
  const { createElement } = React;
  // tsx compiles this component's JSX with the classic runtime.
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { DataTable } = await import('./DataTable');
  type Row = { name: string; team: string };
  const html = renderToStaticMarkup(createElement(DataTable<Row>, {
    caption: 'Standings',
    rows: [{ name: 'Leader', team: '#E80020' }, { name: 'Second', team: '#FF8000' }],
    rowKey: (row: Row) => row.name,
    columns: [{ key: 'name', label: 'Driver', rowHeader: true, cell: (row: Row) => row.name }],
    accent: (row: Row) => row.team,
    highlight: (row: Row) => row.name === 'Leader',
  } as never));
  const rows = html.split('<tr').slice(2);
  assert.match(rows[0]!, /background-color:#E80020/i, 'the leader keeps its own team colour stripe');
  assert.match(rows[0]!, /inset_0_2px_0_var\(--color-brand-red\)/, 'highlight is the red top rule');
  assert.match(rows[1]!, /background-color:#FF8000/i);
  assert.doesNotMatch(rows[1]!, /--color-brand-red/, 'unhighlighted rows carry no red');
});

test('media never leaves an empty frame: the load watchdog fails a frame that stays unloaded once on screen', async () => {
  const { armLoadWatchdog, LOAD_TIMEOUT_MS } = await import('./Media');
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let id = 0, failed = 0, visible: (() => void) | null = null, observing = false;
  const env = {
    setTimeout: (fn: () => void, ms: number) => { timers.set(++id, { fn, ms }); return id; },
    clearTimeout: (t: number) => { timers.delete(t); },
    observe: (_target: unknown, onVisible: () => void) => { observing = true; visible = onVisible; return () => { observing = false; }; },
  };
  const cleanup = armLoadWatchdog({}, () => { failed++; }, LOAD_TIMEOUT_MS, env);
  assert.equal(timers.size, 0, 'no timer before the frame is on screen (lazy images do not load yet)');
  visible!();
  assert.equal(observing, false, 'stops observing once visible');
  assert.deepEqual([...timers.values()].map((t) => t.ms), [8000]);
  [...timers.values()][0]!.fn();
  assert.equal(failed, 1, 'a hung image switches to the unavailable state');
  // Unmount (or a successful load re-running the effect) clears a pending timer.
  const again = armLoadWatchdog({}, () => { failed++; }, 50, { ...env, observe: null });
  assert.equal(timers.size, 2);
  again();
  assert.equal(timers.size, 1);
  cleanup();
  assert.equal(timers.size, 0);
});
