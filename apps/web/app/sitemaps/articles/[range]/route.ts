import { decodeArticleSitemapRange, getArticleSitemapEntries } from '@apex/db';
import { siteOrigin } from '@/components/shell/site-metadata';
import { articleSitemapResponse } from '@/lib/sitemap-xml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, props: { params: Promise<{ range: string }> }) {
  const { range: token } = await props.params;
  const range = token.endsWith('.xml') ? decodeArticleSitemapRange(token.slice(0, -4)) : null;
  if (!range) return new Response('Sitemap not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try { return articleSitemapResponse(siteOrigin(), await getArticleSitemapEntries(range)); }
  catch { return new Response('Sitemap is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } }); }
}
