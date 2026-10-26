import type { ArticleSitemapEntry, ArticleSitemapRange } from '@apex/db';
import { encodeArticleSitemapRange } from '@apex/db';

const MAX_XML_BYTES = 50 * 1024 * 1024;
const MAX_URLS = 50_000;
const xml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
function response(body: string, count: number): Response {
  if (count > MAX_URLS || Buffer.byteLength(body, 'utf8') > MAX_XML_BYTES) throw new Error('Sitemap exceeds the supported XML limits.');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function assemble(root: 'sitemapindex' | 'urlset', entries: string[]): Response {
  return response(`<?xml version="1.0" encoding="UTF-8"?>\n<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</${root}>`, entries.length);
}
function boundedEntries<T>(values: T[], render: (value: T) => string): string[] {
  if (values.length > MAX_URLS) throw new Error('Sitemap exceeds the supported XML limits.');
  const entries: string[] = [];
  let bytes = 256; // XML envelope allowance, checked exactly by response().
  for (const value of values) {
    const entry = render(value);
    bytes += Buffer.byteLength(entry, 'utf8');
    if (bytes > MAX_XML_BYTES) throw new Error('Sitemap exceeds the supported XML limits.');
    entries.push(entry);
  }
  return entries;
}
export function articleSitemapPath(range: ArticleSitemapRange): string {
  return `/sitemaps/articles/${encodeArticleSitemapRange(range)}.xml`;
}
export function sitemapIndexResponse(origin: string, ranges: ArticleSitemapRange[]): Response {
  const paths = ['/sitemap.xml', ...ranges.map(articleSitemapPath)];
  return assemble('sitemapindex', boundedEntries(paths, (path) => `<sitemap><loc>${xml(origin + path)}</loc></sitemap>`));
}
export function articleSitemapResponse(origin: string, entries: ArticleSitemapEntry[]): Response {
  return assemble('urlset', boundedEntries(entries, (entry) => `<url><loc>${xml(`${origin}/article/${encodeURIComponent(entry.slug)}`)}</loc><lastmod>${entry.updatedAt.toISOString()}</lastmod></url>`));
}
