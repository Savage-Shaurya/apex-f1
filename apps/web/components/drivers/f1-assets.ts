/**
 * Sibling assets of a verified F1 media CDN cut-out (lib/f1-media.ts returns
 * the HEAD-validated `...right.webp` cut-out). FOM publishes, beside every
 * driver's `right` pose, a `left` pose and a white race-number glyph under the
 * same name (checked with curl on 2026-10-25 for the 2026 grid). They are
 * derived here, never guessed from scratch, and every consumer renders them
 * with a fallback (the verified right pose, or nothing for the decorative
 * glyph), so a missing sibling never shows a broken image.
 *
 * Candidate for promotion into lib/f1-media-urls.ts (data owner).
 */
import type { ImageCredit } from '@/lib/commons-image';
import type { MediaCredit } from '@/components/ds';

const RIGHT = /right\.webp$/;

/** The same driver facing the other way (towards the right edge of a duel). */
export function facingLeft(cutout: string | null | undefined): string | null {
  return cutout && RIGHT.test(cutout) ? cutout.replace(RIGHT, 'left.webp') : null;
}

/** The driver's race number as FOM's white glyph (decorative; the number is always also text). */
export function numberGlyph(cutout: string | null | undefined): string | null {
  return cutout && RIGHT.test(cutout) ? cutout.replace(RIGHT, 'numberwhitefrless.webp') : null;
}

/** Commons attribution as one Media credit line: "Photo: Author, Licence, Wikimedia Commons". */
export function commonsCredit(credit: ImageCredit | null | undefined): MediaCredit | null {
  if (!credit) return null;
  const parts = [credit.author?.trim() || 'Wikimedia Commons contributor', credit.license?.trim()].filter(Boolean);
  return { label: `Photo: ${parts.join(', ')}, Wikimedia Commons`, href: credit.sourceUrl };
}

export const F1_MEDIA_CREDIT: MediaCredit = { label: 'Image: Formula 1' };
