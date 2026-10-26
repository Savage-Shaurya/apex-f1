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
 * Only the two faces nearly every first screen sets type in are preloaded
 * (Anybody for display, Hanken Grotesk for text). The accent faces (EB
 * Garamond, JetBrains Mono, the italics) are not: a browser fetches a face
 * only when the page actually renders text in it, so they arrive per route
 * without competing with the stylesheet and the largest image on a slow
 * phone (final audit F-06). All faces swap, so text paints at first paint.
 *
 * Anybody is the full variable face with BOTH axes (wdth 50-150, wght
 * 100-900, OFL, see fonts/anybody-OFL.txt). The width axis is the brand's
 * signature: display type stretches with scroll speed and "brakes" into
 * place on reveal. font-stretch is declared as a range so both
 * `font-stretch` and `font-variation-settings: 'wdth'` resolve natively.
 */
const anybody = localFont({
  src: [{ path: './fonts/anybody-wdth-wght.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-anybody',
  display: 'swap',
  declarations: [{ prop: 'font-stretch', value: '50% 150%' }],
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

const fontVars = [anybody, hankenGrotesk, hankenGroteskItalic, ebGaramond, ebGaramondItalic, jetbrainsMono]
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
