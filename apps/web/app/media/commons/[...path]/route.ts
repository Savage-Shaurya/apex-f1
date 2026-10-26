import { serveCommonsImage } from '@/lib/commons-proxy-server';

/**
 * First-party delivery of Wikimedia Commons photos (final audit F-11): the
 * browser never contacts Wikimedia, so no Wikimedia cookie is set and
 * Wikimedia never sees the visitor's IP address. Responses carry long CDN
 * cache headers, so each rendition is fetched from Commons rarely.
 */
export async function GET(request: Request): Promise<Response> {
  // The raw, still percent-encoded path: validation hashes the decoded file name itself.
  return serveCommonsImage(new URL(request.url).pathname);
}
