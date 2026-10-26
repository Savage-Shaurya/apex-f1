'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import '@/components/brand-c/brand-c.css';
import { Icon } from '@/components/ds';
import { isProviderOutageDigest } from '@/lib/provider-outage-digest';

/**
 * Route error boundary in Carbon & Light: big honest type on carbon, the copy
 * says plainly what happened, and the one action is to try again (Next 16
 * `retry` re-fetches and re-renders the segment). No fake status, no stack
 * trace in production; the digest lets the owner match the server log.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const outage = isProviderOutageDigest(error.digest);
  useEffect(() => {
    if (outage) console.warn('[apex] provider unavailable', error.digest);
    else console.error('[apex] route error', error);
  }, [error, outage]);

  // A data provider is down and no earlier copy of this page exists yet: the
  // honest unavailable state, not a crash page (same layout, plainer words).
  const copy = outage
    // Each title is sized to its longest word (bc-display: "unavailable" is 8.8em, "stopped" 5.9em), so no word breaks at 320-1920.
    ? { label: 'Data temporarily unavailable', title: ['Source', 'unavailable'], size: 'text-[clamp(1.75rem,10.8cqi,8.5rem)]', body: 'The racing data behind this page could not be loaded just now, so nothing is shown rather than a guess. It usually comes back within a few minutes.' }
    : { label: 'Something went wrong', title: ['Session', 'stopped'], size: 'text-[clamp(2.25rem,15cqi,8.5rem)]', body: 'Something went wrong while this page was loading. Trying again usually brings it back.' };

  return (
    <section aria-labelledby="route-error-title" className="bc relative isolate min-h-[100svh] overflow-hidden">
      {/* When the failure came from metadata itself the document has no title: React hoists this one into <head>. */}
      <title>{`${copy.label} · Apex`}</title>
      <div aria-hidden className="bc-carbon absolute inset-0 -z-10" />
      <div className="ds-container grid gap-14 py-16 md:py-24 lg:grid-cols-12 lg:items-end lg:gap-8">
        <div className="@container min-w-0 lg:col-span-7">
          <p className="bc-label text-[color:var(--bc-red-text)]">{copy.label}</p>
          <h1 id="route-error-title" className={`bc-display mt-6 ${copy.size}`}>
            {copy.title[0]}{' '}<br />{copy.title[1]}
          </h1>
          <p className="mt-8 max-w-[42ch] text-[clamp(1.125rem,1rem+0.55vw,1.5rem)] leading-[1.45] text-[color:var(--bc-silver)]">
            {copy.body}
          </p>
          {/* Development shows the real error; a known provider outage is logged (console.warn) instead, so the page reads as it will in production. */}
          {process.env.NODE_ENV === 'development' && !outage ? (
            <pre className="bc-mono mt-6 max-h-64 max-w-full overflow-auto whitespace-pre-wrap bg-[color:var(--bc-carbon-2)] p-4 text-[0.875rem] text-[color:var(--bc-silver)]">
              {error.message}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          ) : error.digest ? (
            <p className="bc-mono mt-4 text-[0.875rem] text-[color:var(--bc-titanium)] [overflow-wrap:anywhere]">Reference: {error.digest}</p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col items-stretch gap-4 lg:col-span-5 lg:pb-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-14 items-center justify-between gap-6 bg-[color:var(--bc-white)] px-6 text-[1.0625rem] font-[650] text-[color:var(--bc-night)] transition-colors hover:bg-[color:var(--bc-silver)]"
          >
            Try again
            <Icon name="refresh" size={20} />
          </button>
          <Link
            href="/"
            className="group flex min-h-14 items-center justify-between gap-6 border-y border-[color:var(--bc-rule-strong)] text-[color:var(--bc-white)]"
          >
            <span className="text-[1.0625rem] font-[650]">Back to the home page</span>
            <Icon name="arrow-right" size={20} className="shrink-0 text-[color:var(--bc-red-text)] transition-transform duration-300 ease-[var(--bc-ease)] group-hover:translate-x-1 motion-reduce:transition-none" />
          </Link>
        </div>
      </div>
    </section>
  );
}
