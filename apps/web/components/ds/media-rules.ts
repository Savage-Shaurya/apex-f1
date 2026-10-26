/**
 * No-crop media rules. Every picture slot declares what it holds; the rule
 * decides the frame's aspect ratio and how the picture fills it.
 *
 *  - Photographs keep their subject: `cover` is used only when the source is
 *    close to the frame's ratio (within FIT_TOLERANCE: a 3:2 photo in a 16:9
 *    frame loses under 8% per side, centred or at its focal point). Anything further off
 *    switches to `contain` on the tone surface, so heads, cars and wings are
 *    never cut to fit a template.
 *  - Headshots, cut-outs, logos, cars and circuit drawings always `contain`.
 */

export type MediaKind = 'photo' | 'wide' | 'portrait' | 'square' | 'headshot' | 'logo' | 'car' | 'circuit' | 'video';

export interface MediaRule {
  /** CSS aspect-ratio of the frame. */
  ratio: string;
  /** How the picture fills the frame before its natural size is known. */
  fit: 'cover' | 'contain';
  /** Whether cover may be swapped for contain once the natural ratio is known. */
  adaptive: boolean;
  /** Inner padding for contained marks (percent of the frame). */
  inset: number;
}

export const MEDIA_RULES: Record<MediaKind, MediaRule> = {
  photo: { ratio: '3 / 2', fit: 'cover', adaptive: true, inset: 0 },
  wide: { ratio: '16 / 9', fit: 'cover', adaptive: true, inset: 0 },
  portrait: { ratio: '4 / 5', fit: 'cover', adaptive: true, inset: 0 },
  square: { ratio: '1 / 1', fit: 'cover', adaptive: true, inset: 0 },
  video: { ratio: '16 / 9', fit: 'cover', adaptive: true, inset: 0 },
  headshot: { ratio: '1 / 1', fit: 'contain', adaptive: false, inset: 0 },
  logo: { ratio: '3 / 2', fit: 'contain', adaptive: false, inset: 14 },
  car: { ratio: '21 / 9', fit: 'contain', adaptive: false, inset: 4 },
  circuit: { ratio: '4 / 3', fit: 'contain', adaptive: false, inset: 8 },
};

/** Relative difference between natural and frame ratio that cover may absorb. */
export const FIT_TOLERANCE = 0.2;

export function parseRatio(ratio: string): number {
  const [w, h] = ratio.split('/').map((v) => Number(v.trim()));
  return w && h ? w / h : 1;
}

/**
 * Final fit for a picture whose natural size is known. Cover only when the
 * crop would remove at most FIT_TOLERANCE of either dimension.
 */
export function resolveFit(rule: MediaRule, natural: { width: number; height: number } | null, frameRatio = parseRatio(rule.ratio)): 'cover' | 'contain' {
  if (!rule.adaptive || rule.fit === 'contain') return 'contain';
  if (!natural || !natural.width || !natural.height) return rule.fit;
  const naturalRatio = natural.width / natural.height;
  const difference = Math.abs(naturalRatio - frameRatio) / Math.max(naturalRatio, frameRatio);
  return difference <= FIT_TOLERANCE ? 'cover' : 'contain';
}
