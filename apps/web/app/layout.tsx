import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
// Lenis' base rules load with the root stylesheet (not from ScrollProvider) so the shell stays importable in unit tests.
import 'lenis/dist/lenis.css';
import './globals.css';
import { rootMetadata } from './root-metadata';
import { ShellBody } from './shell-body';
import { FrameProbe } from '@/components/dev/FrameProbe';
import { PosthogScript } from '@/components/shell/PosthogScript';

/**
 * Fonts are committed to ./fonts and loaded with next/font/local, so a
 * build never depends on a third-party font CDN. Provenance, coverage
 * (latin + latin-ext) and the rebuild script are in ./fonts/README.md.
 *
 * Only what nearly every first screen sets type in is preloaded: Hanken
 * Grotesk for text and a ~2 KB cut of Anybody holding just the header
 * wordmark's letters. The full Anybody variable face (80 KB) preloads on
 * every route except home (components/shell/display-face.ts): on a slow
 * phone it competed with the home hero photo (the LCP) for bandwidth to draw
 * four letters (home performance, 2026-10-27). The accent faces (EB
 * Garamond, JetBrains Mono, the italics) are not: a browser fetches a face
 * only when the page actually renders text in it, so they arrive per route
 * without competing with the stylesheet and the largest image on a slow
 * phone (final audit F-06). All faces swap, so text paints at first paint.
 *
 * Anybody is the full variable face with BOTH axes (wdth 50-150, wght
 * 100-900, OFL, see public/fonts/anybody-OFL.txt). The width axis is the brand's
 * signature: display type stretches with scroll speed and "brakes" into
 * place on reveal. font-stretch is declared as a range so both
 * `font-stretch` and `font-variation-settings: 'wdth'` resolve natively.
 */
// The full Anybody variable face is declared in globals.css from public/fonts and preloaded
// per route by components/shell/DisplayFacePreload (every route but home): next/font here
// would preload it on every route, the home page included.
// The header wordmark (components/ds/shell/Wordmark): the same Anybody outlines pinned at
// the instance it is set in (weight 850, width 138%), letters A P E X only. Rebuilt by
// fonts/subset-fonts.py. Any other letter falls through to the full display face.
const anybodyWordmark = localFont({
  src: [{ path: './fonts/anybody-wordmark.woff2', weight: '850', style: 'normal' }],
  variable: '--font-anybody-wordmark',
  display: 'swap',
  // No metric fallback of its own, so a missing glyph reaches the full display face next in the stack.
  adjustFontFallback: false,
  declarations: [{ prop: 'font-stretch', value: '138%' }],
});
// Text and UI face. The full weight axis is registered so semibold/bold UI
// never falls back to a synthesised weight. Figures are tabular by default.
const hankenGrotesk = localFont({
  src: [{ path: './fonts/hanken-grotesk-var.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-hanken',
  display: 'swap',
});
// Italics are separate families so they are only fetched where real
// emphasis appears (globals.css maps em/i/cite onto them).
const hankenGroteskItalic = localFont({
  src: [{ path: './fonts/hanken-grotesk-italic-var.woff2', weight: '100 900', style: 'italic' }],
  variable: '--font-hanken-italic',
  display: 'swap',
  preload: false,
});
const ebGaramond = localFont({
  src: [{ path: './fonts/eb-garamond-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-garamond',
  display: 'swap',
  preload: false,
});
const ebGaramondItalic = localFont({
  src: [{ path: './fonts/eb-garamond-italic-400.woff2', weight: '400', style: 'italic' }],
  variable: '--font-garamond-italic',
  display: 'swap',
  preload: false,
});
const jetbrainsMono = localFont({
  src: [{ path: './fonts/jetbrains-mono-500.woff2', weight: '500', style: 'normal' }],
  variable: '--font-jetbrains',
  display: 'swap',
  preload: false,
});

const fontVars = [anybodyWordmark, hankenGrotesk, hankenGroteskItalic, ebGaramond, ebGaramondItalic, jetbrainsMono]
  .map((font) => font.variable)
  .join(' ');

export const metadata: Metadata = rootMetadata;

export const viewport: Viewport = {
  themeColor: '#0b0b0c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${fontVars}`} data-shell-version="2" suppressHydrationWarning>
      <body className="antialiased">
        <ShellBody>{children}</ShellBody>
        <PosthogScript />
        {process.env.NEXT_PUBLIC_PERFORMANCE_PROBE === '1' && <FrameProbe />}
      </body>
    </html>
  );
}
