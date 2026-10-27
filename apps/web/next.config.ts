import type { NextConfig } from 'next';
import path from 'node:path';
import { prepareBuildReadStore } from './lib/build-read-store';
import { contentSecurityPolicy } from './lib/security-headers';
import { PERMANENT_REDIRECTS } from './lib/redirect-rules';
import { assertSiteOrigin } from './components/shell/site-metadata';

// A production build or start without a real public origin stops here, before
// any canonical, sitemap or OG URL is generated (NEXT_PUBLIC_SITE_URL is the only source).
assertSiteOrigin(process.env);

/** Apex runtime configuration. Development error overlays remain visible. */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework (and so which advisories to try).
  poweredByHeader: false,
  // Independent review output preserves the currently running audit build.
  distDir: process.env.APEX_NEXT_DIST_DIR || '.next',
  transpilePackages: ['@apex/ui', '@apex/types', '@apex/api-client', '@apex/db'],

  // Hide the bottom-left "N" pill and the route-compilation spinner.
  devIndicators: false,

  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },

  // A prerender that waits on a slow or rate-limited provider must finish with its honest state,
  // not be killed: build reads may queue for BUILD_QUEUE_ALLOWANCE_MS on top of their own timeout
  // (packages/api-client/src/build-phase.ts, audit F-01). Next's 60 s default is too short for that.
  staticPageGenerationTimeout: 300,

  experimental: {
    optimizePackageImports: ['framer-motion', 'gsap', '@react-three/drei'],
  },

  // Third-party images render through components/shell/SmartImage, which
  // asks each CDN for its own sized rendition (F1 media Cloudinary `w_`,
  // Wikimedia thumbnail buckets, publisher sizes) with a srcset and `sizes`,
  // so pixels are never proxied twice. These patterns cover any next/image
  // use and list every image host the product loads; stock hosts are gone.
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [390, 640, 828, 1080, 1280, 1440, 1920, 2560],
    imageSizes: [64, 96, 128, 256, 384],
    minimumCacheTTL: 86_400,
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'media.formula1.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org', pathname: '/wikipedia/commons/**' },
      { protocol: 'https', hostname: 'thumb.wikimedia.org', pathname: '/wikipedia/commons/**' },
      { protocol: 'https', hostname: 'commons.wikimedia.org' },
      { protocol: 'https', hostname: '*.motorsport.com' },
      { protocol: 'https', hostname: 'storage.ghost.io' },
      { protocol: 'https', hostname: 'i.guim.co.uk' },
    ],
  },

  async redirects() {
    return PERMANENT_REDIRECTS.map((rule) => ({ ...rule }));
  },

  async headers() {
    const enforcedPolicy = contentSecurityPolicy(process.env);

    return [
      // Versioned display face (components/shell/display-face.ts): the name changes with the file.
      {
        source: '/fonts/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS for 2y incl. subdomains (Vercel terminates TLS).
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Disable powerful features the app never uses.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
          },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Content-Security-Policy',
            value: enforcedPolicy,
          },
        ],
      },
    ];
  },
};

/**
 * During `next build` every worker shares one store of validated Jolpica
 * responses (F-01). The main build process loads this config before it starts
 * the workers, so the directory it names here is inherited by all of them.
 */
export default function config(phase: string): NextConfig {
  prepareBuildReadStore(phase);
  return nextConfig;
}
