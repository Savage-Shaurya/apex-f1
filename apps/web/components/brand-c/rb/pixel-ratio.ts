/** Backing-store pixels a full-screen ambient canvas may spend (about a 2880 x 830 strip at 30 fps). */
export const CANVAS_PIXEL_BUDGET = 2.4e6;

/**
 * Backing-store scale for a WebGL canvas: the screen's density, capped by the caller's ratio and
 * the pixel budget. One pixel per css pixel is the floor for density (audit HNV-7: the light rays
 * were drawn at a quarter of the needed pixels and smeared at 1440), but the budget wins above it
 * (review 2026-11-01): a 2560 px wide hero at one pixel per css pixel was ~3.7M pixels at 30 fps
 * against the 2.4M budget, so a canvas that large goes just below 1 (a soft light, not a hot GPU).
 * Junk input falls back to 1.
 */
export function canvasPixelRatio({ dpr, maxRatio, cssWidth, cssHeight, budget = CANVAS_PIXEL_BUDGET }: {
  dpr: number;
  maxRatio: number;
  cssWidth: number;
  cssHeight: number;
  budget?: number;
}): number {
  const density = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const cap = Number.isFinite(maxRatio) && maxRatio > 0 ? maxRatio : 1;
  const w = Number.isFinite(cssWidth) ? Math.max(1, cssWidth) : 1;
  const h = Number.isFinite(cssHeight) ? Math.max(1, cssHeight) : 1;
  const fit = Math.sqrt((Number.isFinite(budget) && budget > 0 ? budget : CANVAS_PIXEL_BUDGET) / (w * h));
  return Math.min(density, cap, fit);
}
