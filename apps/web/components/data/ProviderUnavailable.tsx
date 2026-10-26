'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ProviderUnavailable({
  title,
  description,
  backHref = '/teams',
  backLabel = 'All teams',
}: {
  title: string;
  description: string;
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);

  function retry() {
    setAttempted(true);
    startTransition(() => router.refresh());
  }

  return (
    <article className="apex-container py-16 md:py-24">
      <p className="text-data text-telemetry-red">TEMPORARILY UNAVAILABLE</p>
      <h1 className="mt-4 font-display text-4xl uppercase text-on-background [overflow-wrap:anywhere] md:text-6xl">{title}</h1>
      <p className="mt-6 max-w-2xl font-editorial text-xl text-on-surface-variant">{description}</p>
      <p className="mt-4 max-w-2xl text-on-surface-variant">This record can&apos;t be shown right now. Please wait a moment and try again.</p>
      <div className="mt-8 flex flex-wrap gap-4">
        <button type="button" onClick={retry} disabled={pending} className="min-h-11 bg-telemetry-red px-5 py-3 text-data text-on-background disabled:opacity-70">
          {pending ? 'Retrying…' : 'Try again'}
        </button>
        <Link href={backHref} className="inline-flex min-h-11 items-center border border-outline-variant px-5 py-3 text-data text-on-background">{backLabel} →</Link>
      </div>
      <p className="mt-4 text-sm text-on-surface-variant" role="status" aria-live="polite">
        {pending ? 'Checking again…' : attempted ? 'Still unavailable? Wait a moment and try again.' : ''}
      </p>
    </article>
  );
}
