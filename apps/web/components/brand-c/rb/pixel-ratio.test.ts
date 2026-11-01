import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canvasPixelRatio } from './pixel-ratio';

test('the light renders at the screen density, up to its cap', () => {
  // /video hero: 1440 x 310 css at dpr 2 was drawn at 0.52 (746 px backing store, audit HNV-7).
  assert.equal(canvasPixelRatio({ dpr: 2, maxRatio: 2, cssWidth: 1440, cssHeight: 310 }), 2);
  assert.equal(canvasPixelRatio({ dpr: 2, maxRatio: 2, cssWidth: 768, cssHeight: 386 }), 2);
  assert.equal(canvasPixelRatio({ dpr: 1, maxRatio: 2, cssWidth: 1440, cssHeight: 310 }), 1);
  assert.equal(canvasPixelRatio({ dpr: 3, maxRatio: 1.5, cssWidth: 390, cssHeight: 300 }), 1.5);
});

test('a large canvas stays at one pixel per css pixel or more while it fits the budget', () => {
  const big = canvasPixelRatio({ dpr: 2, maxRatio: 2, cssWidth: 1440, cssHeight: 900 });
  assert.ok(big >= 1 && big < 2, String(big));
  assert.ok(1440 * 900 * big * big <= 2.4e6 * 1.0001);
  // A dpr below 1 (zoomed out) is honoured.
  assert.equal(canvasPixelRatio({ dpr: 0.8, maxRatio: 2, cssWidth: 800, cssHeight: 400 }), 0.8);
  // Junk input falls back to 1.
  assert.equal(canvasPixelRatio({ dpr: Number.NaN, maxRatio: 2, cssWidth: 0, cssHeight: 0 }), 1);
});

test('review 2026-11-01: above one pixel per css pixel the budget wins (a 2560 px wide hero no longer draws ~3.7M px at 30 fps)', () => {
  for (const [w, h, dpr] of [[2560, 1440, 1], [2560, 1440, 2], [3840, 1600, 1], [4000, 3000, 2]] as const) {
    const ratio = canvasPixelRatio({ dpr, maxRatio: 2, cssWidth: w, cssHeight: h });
    assert.ok(w * h * ratio * ratio <= 2.4e6 * 1.0001, `${w}x${h}@${dpr}: ${Math.round(w * h * ratio * ratio)} px`);
    assert.ok(ratio > 0 && ratio < 1, String(ratio));
  }
});
