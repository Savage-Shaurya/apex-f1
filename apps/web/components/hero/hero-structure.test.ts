import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const web = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, web), 'utf8');

test('HNV-3: /latest and /video put real pictures in the masthead', () => {
  assert.match(read('components/news/carbon.tsx'), /visual\?: ReactNode/);
  for (const page of ['app/latest/page.tsx', 'app/video/page.tsx']) {
    const src = read(page);
    assert.match(src, /visual=\{heroTiles\.length > 0 \? <HeroMosaic/, page);
    assert.match(src, /pickHeroTilesFrom\(/, page);
  }
});

test('HNV-3: the partial-outage line on /latest is a small inline note, not the big panel', () => {
  const src = read('app/latest/page.tsx');
  assert.doesNotMatch(src, /title="A few stories may be missing"/);
  assert.match(src, /<InlineNote>A few stories may be missing/);
});

test('RES-1/RES-2: results skeletons are dark and shaped like the page (hero, leader card, 4-cell stats strip, board)', () => {
  const skeleton = read('components/results/StandingsSkeleton.tsx');
  assert.doesNotMatch(skeleton, /paper/);
  assert.match(skeleton, /lg:col-span-7/);
  assert.match(skeleton, /lg:col-span-5/);
  assert.match(skeleton, /lg:grid-cols-4/);
  assert.match(skeleton, /length: 4/);
  assert.match(skeleton, /bg-\[color:var\(--bc-night\)\]/);
  for (const kind of ['drivers', 'teams']) {
    const loading = read(`app/results/[season]/${kind}/loading.tsx`);
    assert.match(loading, /StandingsSkeleton/, kind);
  }
  assert.doesNotMatch(read('components/schedule/RouteSkeleton.tsx'), /tone="paper"/);
});

test('TEAMS-2: history heroes get the profile car and logo, and the compact hero shows the car', () => {
  const history = read('app/teams/[slug]/history/page.tsx');
  assert.doesNotMatch(history, /logo=\{null\}/);
  assert.doesNotMatch(history, /car=\{null\}/);
  assert.match(history, /getTeamMedia\(/);
  const hero = read('components/teams/TeamHero.tsx');
  assert.doesNotMatch(hero, /!compact && car/);
  assert.match(hero, /visual === 'emblem'/);
});

test('TEAMS-3: historic team pages look up their Commons car photo, and /references credits them', () => {
  assert.match(read('app/teams/[slug]/(profile)/page.tsx'), /getTeamCommonsCar\(/);
  assert.match(read('app/teams/[slug]/history/page.tsx'), /getTeamCommonsCar\(/);
  assert.match(read('components/info/photo-credits.ts'), /TEAM_COMMONS_CARS/);
  assert.match(read('app/references/page.tsx'), /photos\.teams\.map/);
});

test('TEAMS-low: on phones the team picture comes before the numbers; the hero logo sits flush left', () => {
  const hero = read('components/teams/TeamHero.tsx');
  assert.match(hero, /order-3 min-w-0 lg:order-2/);
  assert.match(hero, /order-2 min-w-0 lg:order-3/);
  assert.match(read('components/teams/carbon/teams.css'), /\.tc-hero-logo \.tc-logo \{ object-position: left center; \}/);
});

test('RES-6: a past champion card uses a real credited photo, else a compact plate', () => {
  const card = read('components/results/LeaderCard.tsx');
  assert.match(card, /photo\?: LeaderPhoto \| null/);
  assert.match(card, /sm:flex sm:items-end sm:justify-between/);
  assert.match(read('components/results/StandingsView.tsx'), /pastLeaderPhoto\(/);
});

test('VI-03: /support phones get a visible fan of light and no tall empty foot', () => {
  const stages = read('components/brand-c/stages.tsx');
  assert.match(stages, /bc-kind-still/);
  assert.doesNotMatch(stages, /rgb\(255_120_100\/0\.20\)/);
  const css = read('components/brand-c/brand-c.css');
  assert.match(css, /\.bc-kind-still \{/);
  assert.match(css, /repeating-conic-gradient/);
  const page = read('app/support/page.tsx');
  assert.doesNotMatch(page, /\bpb-40\b/);
});

test('VI-04: info pages carry a real circuit outline in their opening', () => {
  for (const page of ['app/about/page.tsx', 'app/contact/page.tsx', 'app/references/page.tsx', 'app/legal/_components/LegalDocument.tsx']) {
    assert.match(read(page), /<CircuitBackdrop circuitId="[a-z_]+"/, page);
  }
});
