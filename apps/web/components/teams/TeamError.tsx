'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLink, Breadcrumbs, Button, Heading, Section, Text, Unavailable } from '@/components/ds';

/**
 * Error boundary body for the team routes. A provider outage throws in
 * app/teams/[slug]/layout.tsx, so an ISR page that was rendered before keeps
 * serving its last good version (stale-on-error) and a thin outage page is
 * never cached or indexed. Only a first, uncached visit lands here: the
 * designed "Team page unavailable" screen, full height like the skeleton it
 * replaces (no footer jump), with a real retry of the server render.
 * In production the server message is withheld, so the copy says only what is
 * true for every cause.
 */
export function TeamError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ slug?: string }>();
  const pathname = usePathname() ?? '';
  const slug = typeof params?.slug === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(params.slug) ? params.slug : null;
  const history = slug !== null && pathname.endsWith('/history');
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);
  useEffect(() => {
    console.warn('[apex] team route could not render', error.digest ?? error.name);
  }, [error]);
  const crumbs = [{ label: 'Teams', href: '/teams' }, ...(slug ? [{ label: history ? 'Team history' : 'Team profile' }] : [])];
  return (
    <Section tone="carbon" className="min-h-[100svh]">
      {/* A thrown outage skips the route's generateMetadata: the screen names the tab itself (WCAG 2.4.2). */}
      <title>Team page unavailable · Apex</title>
      <Breadcrumbs items={crumbs} />
      <Heading level={1} className="mt-6 [overflow-wrap:normal] [word-break:normal]">Team page unavailable</Heading>
      <Unavailable className="mt-10 max-w-[60rem]" title="Temporarily unavailable">
        This team&apos;s page could not be loaded just now, so nothing is shown rather than a guess. It is usually back within a few minutes.
      </Unavailable>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button variant="secondary" loading={pending} onClick={() => { setTried(true); startTransition(() => retry()); }}>
          {pending ? 'Trying again' : 'Try again'}
        </Button>
        <ArrowLink href="/teams">The current teams</ArrowLink>
        <ArrowLink href="/teams/all">Every constructor</ArrowLink>
      </div>
      <p aria-live="polite" className="mt-4 min-h-[1.45em]">
        {tried && !pending && <Text as="span" size="small" tone="subtle">Still unavailable. Try again in a few minutes.</Text>}
      </p>
      {error.digest && <Text size="small" tone="subtle" className="mt-6">Reference {error.digest}</Text>}
    </Section>
  );
}
