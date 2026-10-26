import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/shell/site-metadata';

export default function robots(): MetadataRoute.Robots {
  const SITE = siteOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account', '/admin', '/api/'],
      },
    ],
    // No non-standard `Host:` line; canonical URLs carry the origin.
    sitemap: `${SITE}/sitemap-index.xml`,
  };
}
