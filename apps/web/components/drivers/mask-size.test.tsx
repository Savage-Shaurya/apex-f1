import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Classic JSX runtime in the test runner reads a global React; components are imported after it is set.
(globalThis as { React?: typeof React }).React = React;
const { DisplayTitle } = await import('./carbon/primitives');
const { ProfileHero } = await import('./ProfileHero');

/**
 * The display headings rise through a `.bc-mask` whose headroom (padding 0.14em
 * top / 0.1em bottom, cancelled by equal negative margins) is in em of the MASK.
 * When the display size sat on the inner span, the mask kept the body size
 * (17px), so a 128px surname got ~2px of headroom and the accent of PÉREZ /
 * HÜLKENBERG was cut off (gate: "cut by span.bc-mask (y)"). The size must be
 * set on the mask itself, with the inner span inheriting it.
 */
function maskStyles(html: string): string[] {
  return [...html.matchAll(/<span class="bc-mask[^"]*"( style="[^"]*")?>/g)].map((m) => m[1] ?? '');
}

test('DisplayTitle sets the display size on its mask, so the mask headroom scales with the type', () => {
  const html = renderToStaticMarkup(<DisplayTitle id="t" text="World champions" />);
  const [mask] = maskStyles(html);
  assert.match(mask ?? '', /font-size:min\(/, `mask must carry the fitted font size, got ${mask}`);
});

test('ProfileHero sets the surname size on its mask (accented surnames keep their accents)', () => {
  const html = renderToStaticMarkup(
    <ProfileHero firstName="Sergio" lastName="Pérez" crumbs={[]} meta={[]} team={null} picture={{ kind: 'none' }} teamColor={null} />,
  );
  const masks = maskStyles(html);
  assert.equal(masks.length, 2);
  assert.match(masks[1] ?? '', /font-size:min\(/, `surname mask must carry the fitted font size, got ${masks[1]}`);
});
