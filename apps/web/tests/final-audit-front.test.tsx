/**
 * Final audit 2026-10-26, frontend findings (unit level; the browser half is
 * tests/browser/final-audit-front.test.mjs).
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { withSocial } from '../lib/page-metadata';
import { clip, displaySize, renderOgCard } from '../lib/og/card';
import { safeCard } from '../lib/og/cards';
import { playName, type VideoView } from '../components/video/video-model';

(globalThis as { React?: unknown }).React = React;
const { VideoTile, FeaturedVideo } = await import('../components/video/VideoCards');

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../app');

test('F-04: withSocial never sets images, so each route\'s own opengraph-image applies', () => {
  const meta = withSocial({ title: 'Lewis Hamilton', description: 'x', alternates: { canonical: '/drivers/hamilton' } });
  assert.ok(!Object.prototype.hasOwnProperty.call(meta.openGraph ?? {}, 'images'));
  assert.ok(!Object.prototype.hasOwnProperty.call(meta.twitter ?? {}, 'images'));
});

/** Pages that only redirect or are internal/noindex need no share card. */
const NO_CARD = new Set(['account', 'admin', 'admin/articles', 'admin/login', 'design', 'brand-preview', 'live', 'membership', 'results', 'results/[season]', 'drivers/hall-of-fame']);

test('F-04: every public page directory has its own share image', () => {
  const missing: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('_') || e.name === 'api' || e.name === 'fonts') continue;
      const abs = path.join(dir, e.name);
      if (existsSync(path.join(abs, 'page.tsx'))) {
        const route = path.relative(app, abs).replace(/\\/g, '/').replace(/\/?\([^)]*\)/g, '');
        if (!NO_CARD.has(route) && !existsSync(path.join(abs, 'opengraph-image.tsx'))) missing.push(route);
      }
      walk(abs);
    }
  };
  walk(app);
  assert.ok(existsSync(path.join(app, 'opengraph-image.tsx')), 'site default card');
  assert.deepEqual(missing, []);
});

test('F-04: a card renders as a 1200x630 PNG with the brand fonts', async () => {
  const res = await renderOgCard({ kicker: 'Driver · Ferrari · No. 44', title: 'Lewis Hamilton', subtitle: 'British · born 1985', stats: [{ label: '2026 position', value: 'P3' }, { label: 'Points', value: '241' }] });
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 630]);
});

test('F-04: card text is bounded; a failing or slow read falls back, never throws', async () => {
  assert.ok(displaySize('Hamilton') <= 128 && displaySize('Constructors championship standings 2026') >= 58);
  assert.ok(clip('a '.repeat(200), 120).length <= 120);
  const fallback = { kicker: 'Formula 1 driver', title: 'Driver profile' };
  assert.deepEqual(await safeCard(async () => { throw new Error('provider down'); }, fallback), fallback);
});

const video = (over: Partial<VideoView> = {}): VideoView => ({
  key: 'k', videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Bono Gets Drenched! 🍾', channel: 'FORMULA 1',
  publishedMs: 0, thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', duration: '0:28', durationSpoken: '28 seconds', views: null, viewCount: null,
  embeddable: true, regionLimited: false, widelyPlayable: true, regionNote: null, ...over,
});

test('F-13: one clean play name: verb, title, running time', () => {
  assert.equal(playName(video()), 'Play: Bono Gets Drenched! 🍾, 28 seconds');
  assert.equal(playName(video(), 'Play video'), 'Play video: Bono Gets Drenched! 🍾, 28 seconds');
  assert.equal(playName(video({ embeddable: false, durationSpoken: null })), 'Watch on YouTube: Bono Gets Drenched! 🍾 (opens in a new tab)');
  for (const html of [renderToStaticMarkup(<VideoTile v={video()} />), renderToStaticMarkup(<FeaturedVideo v={video()} />)]) {
    assert.doesNotMatch(html, /class="sr-only">\s*[:,]/, 'no stray ": " or ", 28 seconds" fragment');
    assert.match(html, /aria-label="Play( video)?: Bono Gets Drenched! 🍾, 28 seconds"/);
  }
});

test('F-06: at most two font faces are preloaded; [data-rv] is never hidden by CSS before hydration', () => {
  const layout = readFileSync(path.join(app, 'layout.tsx'), 'utf8');
  const calls = layout.split('localFont(').slice(1).map((c) => c.slice(0, c.indexOf('});')));
  assert.ok(calls.length >= 2);
  assert.ok(calls.filter((c) => !/preload: false/.test(c)).length <= 2, 'only the critical faces preload');
  const css = readFileSync(path.resolve(here, '../components/brand-c/brand-c.css'), 'utf8');
  assert.doesNotMatch(css, /\[data-rv\][^{]*\{[^}]*opacity:\s*0/, 'no CSS hidden state for reveals');
});

test('F-10: count-ups draw on an aria-hidden overlay and never rewrite the real figure', () => {
  const src = readFileSync(path.resolve(here, '../components/brand-c/ScrollMotion.tsx'), 'utf8');
  assert.doesNotMatch(src, /el\.textContent\s*=/, 'the real value stays in the DOM');
  assert.match(src, /setAttribute\('aria-hidden', 'true'\)/);
});
