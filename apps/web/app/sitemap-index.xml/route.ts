import { getArticleSitemapRanges } from '@apex/db';
import { siteOrigin } from '@/components/shell/site-metadata';
import { sitemapIndexResponse } from '@/lib/sitemap-xml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return sitemapIndexResponse(siteOrigin(), await getArticleSitemapRanges()); }
  // Without article storage the page sitemap is still complete and valid; list only that.
  catch { return sitemapIndexResponse(siteOrigin(), []); }
}
