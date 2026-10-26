/** Resource boundaries follow the current browser integrations, not server-side providers. */
const POSTHOG_DEFAULT = 'https://app.posthog.com';
const POSTHOG_CLOUD = ['https://app.posthog.com', 'https://us.i.posthog.com', 'https://eu.i.posthog.com', 'https://us-assets.i.posthog.com', 'https://eu-assets.i.posthog.com'];
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const VIDEO_FRAME_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'] as const;

/** A privately configured self-hosted analytics origin is allowed explicitly. */
export function posthogResourceOrigin(value: string | undefined): string {
  if (value === undefined || value === '') return POSTHOG_DEFAULT;
  if (value.length > 2_048) throw new Error('Invalid public analytics origin');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      url.hostname.length > 253 || !DNS_NAME.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname)) throw new Error();
    return url.origin;
  } catch { throw new Error('Invalid public analytics origin'); }
}

/**
 * Accepted risk (recorded 2026-10-25, discovery SEC-6): script-src keeps
 * 'unsafe-inline', so this policy does not stop an injected inline script.
 * There is no first-party inline script (the old html.js head script was
 * replaced by the CSS `scripting` media feature, 2026-10-26), no
 * user content is rendered as HTML without sanitising, and a per-request
 * nonce with 'strict-dynamic' would make every page dynamic (no ISR). Revisit
 * if user-generated HTML or a third-party inline snippet is ever added.
 */
export function contentSecurityPolicy(environment: Record<string, string | undefined>): string {
  const development = environment.NODE_ENV === 'development' && !environment.VERCEL && !environment.VERCEL_ENV;
  const analytics = [...new Set([...POSTHOG_CLOUD, posthogResourceOrigin(environment.NEXT_PUBLIC_POSTHOG_HOST)])];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''} ${analytics.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // News providers supply photos from changing publisher CDNs. Permit HTTPS
    // images explicitly instead of breaking genuine publisher media.
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${analytics.join(' ')}${development ? ' ws: wss:' : ''}`,
    `frame-src ${VIDEO_FRAME_ORIGINS.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}
