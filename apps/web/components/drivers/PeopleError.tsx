'use client';

import { useEffect, useState, useTransition } from 'react';
import { ArrowLink, Button, Heading, Text, Unavailable } from '@/components/ds';

/**
 * Area error boundary body for the People routes. In production the server
 * error message is withheld, so the copy says only what is true for every
 * cause: this page's data could not be loaded just now. "Try again" re-runs
 * the server render (Next's retry), not a cosmetic reset.
 */
export function PeopleError({ error, retry, title, backHref, backLabel }: { error: Error & { digest?: string }; retry: () => void; title: string; backHref: string; backLabel: string }) {
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);
  useEffect(() => {
    console.warn('[apex] people route could not render', error.digest ?? error.name);
  }, [error]);
  return (
    <article className="ds-container pb-[var(--space-section)] pt-10 md:pt-16">
      <Heading level={1} size="display-m" caps={false}>{title}</Heading>
      <Unavailable className="mt-8 max-w-[48rem]" title="Temporarily unavailable">
        This page can&apos;t be shown right now. It is usually back within a few minutes.
      </Unavailable>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button variant="secondary" loading={pending} onClick={() => { setTried(true); startTransition(() => retry()); }}>
          {pending ? 'Trying again' : 'Try again'}
        </Button>
        <ArrowLink href={backHref}>{backLabel}</ArrowLink>
      </div>
      <p aria-live="polite" className="mt-4 min-h-[1.45em]">
        {tried && !pending && <Text as="span" size="small" tone="subtle">Still unavailable. Try again in a few minutes.</Text>}
      </p>
      {error.digest && <Text size="small" tone="subtle" className="mt-6">Reference {error.digest}</Text>}
    </article>
  );
}
