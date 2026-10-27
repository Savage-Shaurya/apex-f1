/**
 * The full Anybody variable face (display type, 80 KB). It is a plain public
 * file rather than a next/font face so it can be preloaded per route: next/font
 * in the root layout preloads on every route, and on the home page that 80 KB
 * competed with the hero photo (the LCP) on slow phones to draw four letters
 * of the wordmark (home performance, 2026-10-27). The wordmark now has its own
 * ~2 KB face (app/layout.tsx).
 *
 * Bump the version in the file name whenever the font file changes: it is
 * served with a one-year immutable cache (next.config.ts).
 */
export const DISPLAY_FACE_URL = '/fonts/anybody-wdth-wght-v1.woff2';

/**
 * Home sets display type only below the fold, so it lets the face load when
 * layout reaches it. Every other first screen opens on a display headline that
 * would shift when the face swapped in late, so they preload it as before.
 */
export function preloadsDisplayFace(pathname: string | null): boolean {
  return pathname !== '/';
}
