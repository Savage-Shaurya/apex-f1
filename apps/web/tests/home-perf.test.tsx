/**
 * Home page load budget (2026-10-27): what a slow phone downloads before the
 * hero photo paints. Lighthouse showed the photo (the LCP) sharing a slow
 * connection with every preloaded font, so preloads are kept to the faces the
 * first screen really sets, at the smallest file that draws them.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { React?: unknown }).React = React;
const { Wordmark } = await import('../components/ds/shell/Wordmark');
const { DISPLAY_FACE_URL, preloadsDisplayFace } = await import('../components/shell/display-face');

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../app');
const layout = readFileSync(path.join(app, 'layout.tsx'), 'utf8');

/** Every localFont({...}) call in the root layout with the files it lists and whether it preloads. */
function fontCalls() {
  return layout.split('localFont(').slice(1).map((chunk) => {
    const body = chunk.slice(0, chunk.indexOf('});'));
    const files = [...body.matchAll(/path:\s*'([^']+)'/g)].map((m) => path.join(app, m[1]!));
    return { body, files, preload: !/preload:\s*false/.test(body) };
  });
}

test('preloaded font files stay under 60 KB together (the hero photo gets the bandwidth)', () => {
  const preloaded = fontCalls().filter((c) => c.preload).flatMap((c) => c.files);
  assert.ok(preloaded.length >= 1, 'the text face still preloads');
  const bytes = preloaded.reduce((sum, file) => sum + statSync(file).size, 0);
  assert.ok(bytes < 60 * 1024, `preloaded fonts weigh ${Math.round(bytes / 1024)} KB`);
});

test('the header wordmark has its own tiny preloaded face', () => {
  const mark = fontCalls().find((c) => c.files.some((f) => f.endsWith('anybody-wordmark.woff2')));
  assert.ok(mark, 'the wordmark face is registered');
  assert.ok(mark.preload, 'the wordmark face preloads (it is in the first screen on every page)');
  // Same face, same instance the wordmark is set in: weight 850, width 138%.
  assert.match(mark.body, /weight:\s*'850'/);
  assert.match(mark.body, /font-stretch',\s*value:\s*'138%'/);
  assert.ok(statSync(mark.files[0]!).size < 4 * 1024, 'the wordmark face holds only its letters');
});

test('the full display face preloads on every route except home', () => {
  // Home sets display type only below the fold; every other first screen opens on a display
  // headline, which would shift when the face swapped in late (CLS 0.03-0.07 measured).
  assert.equal(preloadsDisplayFace('/'), false);
  for (const route of ['/support', '/newsletter', '/results', '/predict', '/drivers/hamilton', '/latest']) {
    assert.equal(preloadsDisplayFace(route), true, route);
  }
  assert.equal(preloadsDisplayFace(null), true, 'unknown route: preload, as before');
  // One file, one URL: the @font-face and the preload name the same versioned public file.
  assert.match(DISPLAY_FACE_URL, /^\/fonts\/anybody-wdth-wght-v\d+\.woff2$/);
  assert.ok(statSync(path.join(here, '../public', DISPLAY_FACE_URL)).size > 50 * 1024, 'the full variable face');
  const css = readFileSync(path.join(app, 'globals.css'), 'utf8');
  assert.ok(css.includes(`url('${DISPLAY_FACE_URL}')`), 'globals.css @font-face uses the same URL');
  assert.ok(!fontCalls().some((c) => c.files.some((f) => f.endsWith('anybody-wdth-wght.woff2'))), 'next/font no longer preloads it on every route');
  const shell = readFileSync(path.join(app, 'shell-body.tsx'), 'utf8');
  assert.match(shell, /<DisplayFacePreload \/>/);
  // Long-lived cache for the versioned file.
  assert.match(readFileSync(path.join(here, '../next.config.ts'), 'utf8'), /source: '\/fonts\/:file\*'[\s\S]{0,200}immutable/);
});

test('the header wordmark is set in the wordmark face at the instance it was cut at', () => {
  const html = renderToStaticMarkup(<Wordmark />);
  assert.match(html, /font-wordmark/);
  assert.match(html, /font-stretch:138%/);
  assert.match(html, /font-\[850\]/);
  assert.match(html, />Apex</);
});

test('the wordmark subset is reproducible from the upstream master', () => {
  const script = readFileSync(path.join(app, 'fonts/subset-fonts.py'), 'utf8');
  assert.match(script, /anybody-wordmark\.woff2/);
  assert.match(script, /"wght":\s*850,\s*"wdth":\s*138/);
});
