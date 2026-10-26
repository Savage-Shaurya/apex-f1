/**
 * Browser request boundary for JSON mutations.
 *
 * Call after authenticating the request. Originless requests without browser
 * fetch metadata are allowed for authenticated CLI and scheduled clients;
 * this helper is not an authentication check or a payload-schema validator.
 */
export function getRequestTargetOrigin(req: Request): string | null {
  try {
    const target = new URL(req.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;

    // Next's Node adapter may reconstruct req.url using its listening
    // hostname instead of the browser's requested authority. Host remains
    // the direct HTTP request target; browsers cannot set it via fetch.
    // Prefer it exclusively when present, so an internal reconstructed
    // hostname cannot accidentally authorize a different browser origin.
    const host = req.headers.get('host');
    if (host === null) return target.origin;
    if (!host || /[\s,/\\?#@]/.test(host) || host.endsWith(':')) return null;
    const authority = new URL(`${target.protocol}//${host}`);
    if (!authority.hostname || authority.pathname !== '/' || authority.search || authority.hash) return null;
    return authority.origin;
  } catch {
    return null;
  }
}

export function isSameOriginMutationRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');

  // A contradictory browser signal must not be overridden by another header.
  if (fetchSite !== null && fetchSite !== 'same-origin') return false;
  const targetOrigin = getRequestTargetOrigin(req);
  if (targetOrigin === null) return false;

  if (origin !== null) {
    try {
      const source = new URL(origin);
      return (
        source.origin === origin &&
        (source.protocol === 'http:' || source.protocol === 'https:') &&
        source.origin === targetOrigin
      );
    } catch {
      return false;
    }
  }

  return fetchSite === null || fetchSite === 'same-origin';
}

/** null permits the boundary check; handlers still validate the JSON body. */
export function validateJsonMutationRequest(req: Request): Response | null {
  const type = req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!type || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(type)) {
    return Response.json({ error: 'Content-Type must be application/json' }, {
      status: 415,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (!isSameOriginMutationRequest(req)) {
    return Response.json({ error: 'Cross-origin mutation is not allowed' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return null;
}
