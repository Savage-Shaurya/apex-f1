import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;
const { LitPortrait } = await import('./carbon/primitives');
const { CarStage } = await import('../teams/carbon/CarStage');

/**
 * Audit 2026-11-01 DRV-4 / TEAMS-5: a CSS mask-image ignores loading="lazy", so a
 * mask URL in the server HTML downloads every card's photo at page open. The
 * mask (and the car's reflection) must wait for the photo's own <img> to load.
 */
const CUTOUT = 'https://media.formula1.com/image/upload/c_fill,g_north,ar_4:5,w_640,q_auto,f_auto/common/f1/2026/mercedes/georus01/2026mercedesgeorus01right.webp';
const CAR = 'https://media.formula1.com/image/upload/c_fit,w_1280,q_auto,f_auto/common/f1/2026/ferrari/2026ferraricarright.webp';

test('DRV-4: LitPortrait renders no mask URL before its photo has loaded', () => {
  const html = renderToStaticMarkup(<LitPortrait src={CUTOUT} name="George Russell" teamColor="#27F4D2" />);
  assert.match(html, /<img/);
  assert.doesNotMatch(html, /--src:url\(/);
  assert.doesNotMatch(html, /mask-image/);
});

test('TEAMS-5: CarStage renders no mask URL or reflection before the car has loaded', () => {
  const html = renderToStaticMarkup(<CarStage src={CAR} alt="Ferrari car" color="#E8002D" />);
  assert.match(html, /tc-car/);
  assert.doesNotMatch(html, /--src:url\(/);
  assert.doesNotMatch(html, /tc-reflect/);
});
