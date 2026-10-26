import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShellBody } from './shell-body';
import { ConsentBanner } from '../components/ds/shell/ConsentBanner';
import { SiteFooter } from '../components/ds/shell/SiteFooter';
import PrivacyPage from './legal/privacy/page';

// Components here compile with the classic JSX runtime under tsx.
(globalThis as { React?: unknown }).React = React;

/**
 * F-12 (final audit 2026-10-26): the cookie banner asked for analytics consent
 * although production configures no analytics provider, so "Accept" changed
 * nothing. The banner, the "Cookie preferences" controls and the analytics
 * wording on /legal/privacy exist only when an analytics provider is
 * configured (NEXT_PUBLIC_POSTHOG_KEY); with one, the full consent flow stays.
 */
function withAnalyticsKey(value: string | undefined, run: () => void) {
  const previous = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (value === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = value;
  try { run(); } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = previous;
  }
}

function elements(node: React.ReactNode, out: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) { for (const child of node) elements(child, out); return out; }
  if (!React.isValidElement(node)) return out;
  out.push(node);
  elements((node.props as { children?: React.ReactNode }).children, out);
  return out;
}

const banners = () => elements(ShellBody({ children: null })).filter((el) => el.type === ConsentBanner).length;
const footer = () => renderToStaticMarkup(React.createElement(SiteFooter, { season: 2026 }));
const privacy = () => renderToStaticMarkup(React.createElement(PrivacyPage));

for (const [label, value] of [['unset', undefined], ['blank', '   ']] as const) {
  test(`analytics key ${label}: no consent banner, no Cookie preferences control, and the privacy page says no analytics run`, () => {
    withAnalyticsKey(value, () => {
      assert.equal(banners(), 0, 'no consent banner without an analytics provider');
      assert.doesNotMatch(footer(), /Cookie preferences/, 'footer has no control that does nothing');
      const html = privacy();
      assert.doesNotMatch(html, /Cookie preferences/, 'privacy page has no control that does nothing');
      assert.doesNotMatch(html, /PostHog/, 'no analytics processor is named when none is configured');
      assert.doesNotMatch(html, /if you accept analytics|after you accept analytics|apex\.consent\.v1/i);
      assert.match(html, /Apex runs no analytics/);
    });
  });
}

test('analytics key configured: the banner renders once, the footer and privacy page offer Cookie preferences, and PostHog is disclosed', () => {
  withAnalyticsKey('phc_public_test_key', () => {
    assert.equal(banners(), 1, 'banner rendered once');
    assert.match(footer(), /Cookie preferences/);
    const html = privacy();
    assert.match(html, /Cookie preferences/);
    assert.match(html, /PostHog/);
    assert.match(html, /apex\.consent\.v1/);
    assert.doesNotMatch(html, /Apex runs no analytics/);
  });
});
