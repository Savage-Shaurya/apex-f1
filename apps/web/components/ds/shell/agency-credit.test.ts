import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SiteFooter } from './SiteFooter';

// Components here compile with the classic JSX runtime under tsx.
(globalThis as { React?: unknown }).React = React;

// Owner decision 2026-10-29: Apex is credited to Snappy Crew, the owner's agency, and every page
// footer links visitors to snappycrew.com.
test('every footer credits Snappy Crew with a working external link to snappycrew.com', () => {
  const html = renderToStaticMarkup(React.createElement(SiteFooter, { season: 2026 }));
  const link = html.match(/<a[^>]*href="https:\/\/snappycrew\.com"[^>]*>\s*Snappy Crew\s*<\/a>/);
  assert.ok(link, 'footer has a "Snappy Crew" link to https://snappycrew.com');
  assert.match(link[0], /target="_blank"/);
  assert.match(link[0], /rel="noopener"/);
  assert.match(html, /Built by/);
});
