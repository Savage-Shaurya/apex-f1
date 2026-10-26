'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLink, Breadcrumbs, Button, Heading, Section, Text, Unavailable } from '@/components/ds';
import { isProviderOutageDigest } from '@/lib/provider-outage-digest';

/**
 * Race weekend error boundary. A calendar outage throws (lib/race-detail:
 * an ISR page keeps its last good render, a thin outage page is never
 * indexed); on a first, uncached visit the reader gets the same designed
 * "Race weekend unavailable" state as the page's own outage branch, inside
 * the schedule, instead of the generic crash page. "Try again" re-runs the
 * server render. Fills the viewport like the loading skeleton it replaces,
 * so the footer never jumps into view.
 */
export default function RaceWeekendError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ season?: string }>();
  const season = /^\d{4}$/.test(params?.season ?? '') ? params.season! : null;
  const outage = isProviderOutageDigest(error.digest);
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (outage) console.warn('[apex] race weekend data unavailable', error.digest);
    else console.error('[apex] race weekend could not render', error);
  }, [error, outage]);
  const back = season ? `/schedule/${season}` : '/schedule';
  return (
    <Section tone="carbon" className="min-h-[100svh]">
      {/* A thrown outage skips the route's generateMetadata: the screen names the tab itself (WCAG 2.4.2). */}
      <title>Race weekend unavailable · Apex</title>
      <Breadcrumbs items={[{ label: 'Schedule', href: '/schedule' }, ...(season ? [{ label: season, href: back }] : []), { label: 'Race weekend' }]} />
      <Heading level={1} className="mt-6">Race weekend unavailable</Heading>
      <Unavailable className="mt-10 max-w-[60rem]" title="Race details unavailable">
        {outage
          ? 'The racing data for this weekend could not be loaded just now, so nothing is shown rather than a guess. It is usually back within a few minutes.'
          : 'Something went wrong while this race weekend was loading. Trying again usually brings it back.'}
      </Unavailable>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button variant="secondary" loading={pending} onClick={() => { setTried(true); startTransition(() => retry()); }}>
          {pending ? 'Trying again' : 'Try again'}
        </Button>
        <ArrowLink href={back}>{season ? `The ${season} calendar` : 'The race calendar'}</ArrowLink>
      </div>
      <p aria-live="polite" className="mt-4 min-h-[1.45em]">
        {tried && !pending && <Text as="span" size="small" tone="subtle">Still unavailable. Try again in a few minutes.</Text>}
      </p>
      {error.digest && !outage && <Text size="small" tone="subtle" className="mt-6">Reference {error.digest}</Text>}
    </Section>
  );
}
