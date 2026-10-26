/**
 * The canonical public origin has exactly one source: NEXT_PUBLIC_SITE_URL.
 * Metadata, Open Graph, canonical links, the sitemap, robots, JSON-LD and the
 * provider User-Agent all read it through here (the GitHub Actions schedulers
 * use the same value as the repository variable APEX_SITE_URL).
 *
 * No production host is hard-coded: the domain changes with the hosting
 * account (example values: apps/web/.env.example).
 *
 * On the production deployment (VERCEL_ENV=production), or wherever
 * APEX_STRICT_ENV=true is set for a local production rehearsal, a missing,
 * non-HTTPS, loopback or credential-carrying value stops the build and the
 * server start (next.config.ts, instrumentation.ts) instead of publishing
 * canonicals, a sitemap and OG images that point at the wrong host. Locally
 * and on previews, an unset value falls back to the local dev origin.
 */
const LOCAL_ORIGIN = 'http://localhost:3000';

type Env = Readonly<Record<string, string | undefined>>;

export type SiteOriginIssue = 'missing' | 'invalid' | 'not-https' | 'loopback' | 'foreign-vercel-host';

/** Same rule as lib/startup-env.ts: the production deployment, or an explicit local rehearsal. */
export function strictSiteEnvironment(env: Env): boolean {
  return env.VERCEL_ENV === 'production' || env.APEX_STRICT_ENV === 'true';
}

function parse(value: string | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Why NEXT_PUBLIC_SITE_URL cannot be the production origin, or null when it can. */
export function siteOriginIssue(env: Env): SiteOriginIssue | null {
  if (!env.NEXT_PUBLIC_SITE_URL?.trim()) return 'missing';
  const url = parse(env.NEXT_PUBLIC_SITE_URL);
  if (!url) return 'invalid';
  if (isLoopback(url.hostname)) return 'loopback';
  if (url.protocol !== 'https:') return 'not-https';
  // A *.vercel.app origin that is not this project's own production host once
  // pointed every canonical and OG image at an unrelated site.
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  if (vercelHost && url.hostname.endsWith('.vercel.app') && url.hostname !== vercelHost) return 'foreign-vercel-host';
  return null;
}

const REASON: Record<SiteOriginIssue, string> = {
  missing: 'is not set',
  invalid: 'is not a valid http(s) origin without credentials',
  'not-https': 'must use https',
  loopback: 'points at localhost or a loopback address',
  'foreign-vercel-host': "is a *.vercel.app host other than this project's production host",
};

/** Production fail-fast for the canonical origin (build, start and first render). */
export function assertSiteOrigin(env: Env = process.env): void {
  if (!strictSiteEnvironment(env)) return;
  const issue = siteOriginIssue(env);
  if (issue) {
    throw new Error(`NEXT_PUBLIC_SITE_URL ${REASON[issue]} (${issue}). Set it to the public HTTPS origin of this deployment in the hosting provider's Production environment variables, then rebuild.`);
  }
}

/** The canonical origin (scheme + host, no path). */
export function siteOrigin(env: Env = process.env): string {
  assertSiteOrigin(env);
  return parse(env.NEXT_PUBLIC_SITE_URL)?.origin ?? LOCAL_ORIGIN;
}

// Season labels and links come from lib/season.ts (real calendar and
// standings), never from the clock year.
