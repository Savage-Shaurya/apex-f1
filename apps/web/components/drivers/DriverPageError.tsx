'use client';

import { useEffect, useState, useTransition } from 'react';
import { ArrowLink, Breadcrumbs, Button, Heading, Section, Text, Unavailable } from '@/components/ds';

/**
 * Designed error screen for the driver profile and career routes. A provider
 * outage throws there on purpose: an ISR page that was cached while the data
 * was healthy keeps serving its last good render (stale-on-error), and an
 * outage is never cached or indexed as a thin page. Only a first, uncached
 * visit lands here (HTTP 500: Next 16 cannot send 503 from a render). The copy
 * names no data provider; it fills the viewport like the loading skeleton it
 * replaces, so the footer never jumps into view; "Try again" re-runs the
 * server render (Next's retry), and the grid and the archive are one tap away.
 */
export function DriverPageError({ error, retry, title = 'Driver page unavailable' }: { error: Error & { digest?: string }; retry: () => void; title?: string }) {
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);
  useEffect(() => {
    console.warn('[apex] driver page could not render', error.digest ?? error.name);
  }, [error]);
  return (
    <Section tone="carbon" className="min-h-[100svh]">
      {/* A thrown outage skips the route's generateMetadata: the screen names the tab itself (WCAG 2.4.2). */}
      <title>{`${title} · Apex`}</title>
      <Breadcrumbs items={[{ label: 'Drivers', href: '/drivers' }, { label: 'Driver' }]} />
      <Heading level={1} size="display-m" caps={false} className="mt-6 [overflow-wrap:normal] [word-break:normal]">{title}</Heading>
      <Unavailable className="mt-10 max-w-[60rem]" title="Temporarily unavailable">
        The racing data for this driver could not be loaded just now, so nothing is shown rather than a guess. It is usually back within a few minutes.
      </Unavailable>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button variant="secondary" loading={pending} onClick={() => { setTried(true); startTransition(() => retry()); }}>
          {pending ? 'Trying again' : 'Try again'}
        </Button>
        <ArrowLink href="/drivers">The current grid</ArrowLink>
        <ArrowLink href="/drivers/all">Every driver</ArrowLink>
      </div>
      <p aria-live="polite" className="mt-4 min-h-[1.45em]">
        {tried && !pending && <Text as="span" size="small" tone="subtle">Still unavailable. Try again in a few minutes.</Text>}
      </p>
      {error.digest && <Text size="small" tone="subtle" className="mt-6">Reference {error.digest}</Text>}
    </Section>
  );
}
