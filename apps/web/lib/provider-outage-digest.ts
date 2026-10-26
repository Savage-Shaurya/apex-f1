/**
 * Stable digest for provider outages, safe to import from client error
 * boundaries. Next keeps an error's own `digest` (create-error-handler), and in
 * production the digest is the only thing a boundary learns about a server
 * error. Marking outages this way lets the boundary show the designed, honest
 * "source temporarily unavailable" state instead of a generic crash page on a
 * first, uncached visit while a provider is down.
 */
export const PROVIDER_OUTAGE_DIGEST = 'APEX_PROVIDER_OUTAGE';

export function providerOutageDigest(area: string): string {
  const safe = area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return safe ? `${PROVIDER_OUTAGE_DIGEST}:${safe}` : PROVIDER_OUTAGE_DIGEST;
}

export function isProviderOutageDigest(digest: string | undefined | null): boolean {
  return typeof digest === 'string' && (digest === PROVIDER_OUTAGE_DIGEST || digest.startsWith(`${PROVIDER_OUTAGE_DIGEST}:`));
}
