/**
 * One identifying User-Agent for every server-side provider request.
 *
 * Wikimedia's User-Agent policy (and good API manners generally) asks for a
 * way to reach the operator. The contact is the public site, read from
 * NEXT_PUBLIC_SITE_URL (the one source of the canonical origin; the domain
 * changes with the hosting account, so none is hard-coded). A missing,
 * non-HTTPS or loopback value is left out rather than advertised. No e-mail
 * address on a domain the project does not own, and no repository link.
 */
export function apexSiteUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function apexUserAgent(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const site = apexSiteUrl(env);
  return `Apex/0.1 (unofficial Formula 1 fan project${site ? `; +${site}` : ''})`;
}

export const APEX_USER_AGENT = apexUserAgent();
