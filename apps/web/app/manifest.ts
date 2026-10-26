import type { MetadataRoute } from 'next';

/** Install metadata. Icons are rendered from the committed favicon.svg mark (black field, red apex). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Apex · Independent Formula 1 fan platform',
    short_name: 'Apex',
    description: 'Apex is an independent, fan-built Formula 1 platform: schedule, results, drivers, teams, news and video.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b0b0c',
    theme_color: '#0b0b0c',
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
