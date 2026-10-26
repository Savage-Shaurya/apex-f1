import { Suspense, type ReactNode } from 'react';
import { ScrollProvider } from '@/components/motion/ScrollProvider';
import { MotionPreferencesProvider } from '@/components/motion/MotionPreferencesProvider';
import { VideoPlayerModal } from '@/components/video/VideoPlayerModal';
import { ConsentBanner } from '@/components/ds/shell/ConsentBanner';
import { SiteFooterServer, SiteHeaderServer } from '@/components/ds/shell/server';
import { analyticsConfigured } from '@/lib/analytics-config';

/**
 * The site shell inside <body>: skip link, consent banner (first in the tab
 * order, and only when an analytics provider is configured: with nothing to
 * consent to there is no banner), header, main, footer. Its own module so its structure is tested by
 * rendering, without the root layout's CSS and font imports.
 */
export function ShellBody({ children }: { children: ReactNode }) {
  return (
    <MotionPreferencesProvider>
      <ScrollProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:bg-brand-red focus:px-5 focus:font-text focus:text-ui focus:font-[650] focus:text-white"
        >
          Skip to content
        </a>
        {/* First after the skip link: the consent prompt is reached before the page, never after 90 tab stops. */}
        {analyticsConfigured() && <ConsentBanner />}
        {/* Not behind a Suspense fallback: the bar (wordmark, Give back, Search, Menu) is in the first HTML and
            only its read-dependent parts stream in (SiteHeader). A suspended or outlined header boundary was
            revealed after 'load', so Tab went Skip -> wordmark -> page and missed the menu. */}
        <SiteHeaderServer />
        <main id="main" tabIndex={-1} className="relative pt-[var(--shell-h)] focus:outline-none">
          {children}
        </main>
        <Suspense fallback={null}>
          <SiteFooterServer />
        </Suspense>
        <VideoPlayerModal />
      </ScrollProvider>
    </MotionPreferencesProvider>
  );
}
