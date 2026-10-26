/** Next.js returns repeated query parameters as arrays. Ambiguous or excessive
 * public filters clear to the ordinary all-results state instead of choosing an
 * arbitrary value or passing an array into client-side string operations. */
export function scalarPublicQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 256 ? value : undefined;
}
