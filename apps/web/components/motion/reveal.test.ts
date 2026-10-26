import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { countdownParts, countdownSubscription } from '../ds/use-countdown';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');

// Motion audit 2026-10-26 (A11Y-1, "the headshot comes from the bottom and
// shifts up"): section groups, headlines and nameplates render in place, at
// full layout, from the first paint. No entrance tween, no hidden state.
for (const file of ['./Reveal.tsx', './BrakeIn.tsx', '../fx/SplitReveal.tsx', '../teams/DriveIn.tsx', '../live/DrawOnView.tsx']) {
  test(`${file} renders in place with no entrance motion or hidden state`, () => {
    const src = read(file);
    assert.doesNotMatch(src, /from 'gsap|useGSAP|ScrollTrigger/, 'no scroll tween');
    assert.doesNotMatch(src, /autoAlpha|visibility:|opacity:|translate[XY3(]|data-split=/, 'nothing hidden, faded or moved');
  });
}
for (const file of ['../drivers/motion/Rise.tsx', '../../app/support/_components/Rise.tsx']) {
  test(`${file} is the in-place Reveal group`, () => {
    assert.match(read(file), /export \{ Reveal as Rise \} from '@\/components\/motion\/Reveal'/);
  });
}

test('one scroll clock: Lenis stepped by GSAP\'s ticker, no wheel dead zones, no custom cursor', () => {
  const provider = read('./ScrollProvider.tsx');
  // 2026-10-26 home redesign: smoothing returns, driven by the one clock.
  assert.match(provider, /from 'lenis\/react'/);
  assert.match(provider, /gsap\.ticker\.add\(step\)/, 'Lenis is stepped by GSAP\'s ticker');
  assert.match(provider, /autoRaf: false/, 'Lenis never runs its own rAF loop');
  assert.match(provider, /syncTouch: false/, 'touch keeps native momentum');
  assert.match(provider, /lenis\.on\('scroll', update\)/, 'ScrollTrigger updates from Lenis');
  assert.match(provider, /prefers-reduced-motion: no-preference/, 'off under reduced motion');
  assert.match(provider, /ScrollTrigger\.refresh\(\)/, 'scenes re-measure when the document settles');
  assert.match(read('../../app/shell-body.tsx'), /<ScrollProvider>/);
  const css = read('../../app/globals.css');
  assert.doesNotMatch(css, /apex-cursor|data-split|data-intro|data-ds-reveal/);
  // No prevent regions anywhere a wheel passes: rails must let the page scroll.
  for (const file of ['../shell/ModalDialog.tsx', '../brand-c/SeasonRail.tsx', '../brand-c/HeadlineTicker.tsx', '../brand-c/Championship.tsx']) {
    assert.doesNotMatch(read(file), /data-lenis-prevent/, `${file} has no wheel dead zone`);
  }
});

test('the WebGL support probe releases its context (PERF2-6)', () => {
  assert.match(read('./LazyStage.tsx'), /WEBGL_lose_context'\)\?\.loseContext\(\)/);
});

test('status and Give back marks are words or shapes, never dots', () => {
  const badge = read('../ds/Badge.tsx');
  assert.doesNotMatch(badge.slice(badge.indexOf('const STATUS'), badge.indexOf('export type TyreCompound')), /rounded-full|animate-ping/);
  for (const file of ['../ds/shell/SiteHeader.tsx', '../ds/shell/SiteFooter.tsx', '../race/WeekendSchedule.tsx']) {
    assert.doesNotMatch(read(file), /size-1\.5 shrink-0 rounded-full|size-3\.5 rounded-full/, `${file} has no decorative dot`);
  }
  assert.doesNotMatch(read('../../app/support/page.tsx'), /_components\/KindLight/, 'the old title dot stays gone (the warm brand-c light is allowed)');
});

test('countdown parts: dashes on the server, a frozen zero once the start is reached', () => {
  const start = Date.parse('2026-10-25T19:00:00Z');
  assert.deepEqual(countdownParts(start, null), { valid: true, started: false, days: null, hours: null, minutes: null, seconds: null });
  const before = countdownParts(start, start - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000));
  assert.deepEqual([before.days, before.hours, before.minutes, before.seconds, before.started], [2, 3, 4, 5, false]);
  const after = countdownParts(start, start + 60_000);
  assert.equal(after.started, true);
  assert.deepEqual([after.days, after.hours, after.minutes, after.seconds], [0, 0, 0, 0]);
  assert.equal(countdownParts(null, Date.now()).valid, false);
});

test('the header countdown ticks each second and stops on the tick that reaches the start', () => {
  let now = 0;
  const timers = new Map<number, () => void>();
  let next = 1;
  const clock = { now: () => now, setInterval: (tick: () => void) => { timers.set(next, tick); return next++; }, clearInterval: (id: number) => { timers.delete(id); } };
  let changes = 0;
  const unsubscribe = countdownSubscription(3000, () => { changes++; }, clock);
  const tick = () => { now += 1000; [...timers.values()].forEach((fn) => fn()); };
  tick(); tick();
  assert.equal(changes, 2); assert.equal(timers.size, 1);
  tick(); // reaches the start
  assert.equal(changes, 3); assert.equal(timers.size, 0, 'interval cleared at the start');
  tick();
  assert.equal(changes, 3, 'no tick after the start');
  unsubscribe();
  // Already started, or no time known: nothing is scheduled.
  countdownSubscription(1000, () => { changes++; }, clock);
  countdownSubscription(null, () => { changes++; }, clock);
  assert.equal(timers.size, 0);
});
