import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: typeof React }).React = React;
const { DriverPageError } = await import('./DriverPageError');

/**
 * The designed error screen of /drivers/[slug] and /drivers/[slug]/career (a
 * provider outage throws there, so a cached good page keeps serving; an
 * uncached one lands here). It names no data provider, fills the viewport like
 * the skeleton it replaces (no footer jump), and offers a real retry and a way out.
 */
const outage = Object.assign(new Error('The driver record could not be confirmed with Jolpica F1'), { digest: '123' });

test('driver page error: designed heading, honest copy, no provider names', () => {
  const html = renderToStaticMarkup(<DriverPageError error={outage} retry={() => {}} />);
  assert.match(html, /<h1[^>]*>Driver page unavailable<\/h1>/);
  assert.doesNotMatch(html, /jolpica|openf1|wikipedia|provider/i);
  assert.match(html, /Try again/);
  assert.match(html, /href="\/drivers"/);
  assert.match(html, /href="\/drivers\/all"/);
});

test('driver page error fills the viewport like the loading skeleton (no footer jump)', () => {
  const html = renderToStaticMarkup(<DriverPageError error={outage} retry={() => {}} />);
  assert.match(html, /min-h-\[100svh\]/);
});

test('both driver routes and the drivers area boundary use it', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['../../app/drivers/[slug]/error.tsx', '../../app/drivers/error.tsx']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /DriverPageError/, file);
  }
});
