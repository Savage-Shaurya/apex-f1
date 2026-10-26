import { isSportUnavailable } from './public-sport';
import { providerOutageDigest } from './provider-outage-digest';

/**
 * A data provider outage on a page whose content IS that data (a driver
 * profile, a race page). Throw it instead of rendering a 200 "unavailable"
 * body: the route error boundary (app/error.tsx) answers HTTP 500, an ISR
 * page keeps serving its last good render during revalidation, and search
 * engines neither index a thin outage page nor drop a good page for a
 * noindex that only meant "try later". Confirmed-missing data still uses
 * notFound() (404), never this.
 *
 * Discovery SEO-2 (2026-10-25). Pages adopt it as they are rebuilt.
 */
export class ProviderOutageError extends Error {
  /** Kept by Next as the client-visible digest, so boundaries can render the unavailable state. */
  readonly digest: string;
  constructor(readonly area: string) {
    super(`Provider data temporarily unavailable: ${area}`);
    this.name = 'ProviderOutageError';
    this.digest = providerOutageDigest(area);
  }
}

export function providerOutage(area: string): never {
  throw new ProviderOutageError(area);
}

/** Converts an expected provider failure (see isSportUnavailable) into an outage; other errors pass through. */
export async function orOutage<T>(area: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { if (isSportUnavailable(error)) providerOutage(area); throw error; }
}
