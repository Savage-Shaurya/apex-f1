'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLink, Button, Heading, Text, Unavailable } from '@/components/ds';

/**
 * Whole-page unavailable state for the People routes (DS version of
 * components/data/ProviderUnavailable): the page title, a truthful reason
 * with its source, a real retry that re-reads the provider, and a way out.
 */
export function PeopleUnavailable({ title, reason, backHref, backLabel }: { title: string; reason: string; backHref: string; backLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);
  return (
    <article className="ds-container pb-[var(--space-section)] pt-10 md:pt-16">
      <Heading level={1} size="display-m" caps={false}>{title}</Heading>
      <Unavailable className="mt-8 max-w-[48rem]" title="Temporarily unavailable">
        {reason}
      </Unavailable>
      <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button variant="secondary" loading={pending} onClick={() => { setTried(true); startTransition(() => router.refresh()); }}>
          {pending ? 'Trying again' : 'Try again'}
        </Button>
        <ArrowLink href={backHref}>{backLabel}</ArrowLink>
      </div>
      <p aria-live="polite" className="mt-4 min-h-[1.45em]">
        {tried && !pending && <Text as="span" size="small" tone="subtle">Still unavailable. Please try again in a few minutes.</Text>}
      </p>
    </article>
  );
}
