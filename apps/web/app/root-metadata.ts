import type { Metadata } from 'next';
import { siteOrigin } from '@/components/shell/site-metadata';

// Root metadata, in its own module so tests can read it without the layout's
// CSS and font imports. Canonical origin: siteOrigin(), i.e. NEXT_PUBLIC_SITE_URL
// (required on production; see components/shell/site-metadata.ts).
const SITE = 'Apex';
const DESCRIPTION =
  'Apex is an independent, fan-built Formula 1 platform. Schedule, results and standings back to 1950, drivers, teams, news, video and timing from finished sessions.';

export const rootMetadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: `${SITE} · Independent Formula 1 fan platform`,
    template: `%s · ${SITE}`,
  },
  description: DESCRIPTION,
  applicationName: SITE,
  authors: [{ name: 'Shaurya Punj', url: 'https://shauryapunj.com' }],
  creator: 'Shaurya Punj',
  publisher: 'Shaurya Punj',
  keywords: ['Formula 1', 'F1', 'Grand Prix', 'race results', 'session timing', 'driver standings'],
  openGraph: {
    type: 'website',
    siteName: SITE,
    title: `${SITE} · Independent Formula 1 fan platform`,
    description: DESCRIPTION,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE,
    description: DESCRIPTION,
    creator: '@SnappyLeader',
  },
  icons: { icon: '/favicon.svg' },
};

