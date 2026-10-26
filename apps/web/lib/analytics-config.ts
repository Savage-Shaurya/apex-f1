/**
 * Whether an analytics provider is configured for this build.
 *
 * The cookie banner, the "Cookie preferences" controls and the analytics
 * wording on /legal/privacy exist only when this is true: asking for consent
 * to analytics that do not exist would be a dark pattern (final audit F-12).
 *
 * `process.env.NEXT_PUBLIC_POSTHOG_KEY` is written out literally so Next
 * inlines it into client bundles; server components read the same value.
 */
export function analyticsConfigured(): boolean {
  return (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim().length > 0;
}
