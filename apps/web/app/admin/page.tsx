import type { Metadata } from 'next';
import { ArrowLink, Heading, Label, StatusBadge, Text } from '@/components/ds';
import { adminAuthenticationConfigured } from '@/lib/admin-auth';
import { redisAvailability } from '@/lib/health';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin',
  description: 'Apex editorial console. Internal use.',
  robots: { index: false, follow: false },
};

interface Check { label: string; ok: boolean; on: string; off: string; consequence: string; badge?: string }

function redisReason(kind: string | null): string {
  if (kind === 'redis-quota') return 'its request quota is spent';
  if (kind === 'redis-auth') return 'its credentials were refused';
  if (kind === 'redis-invalid-reply') return 'it returned a reply the code did not expect';
  return 'it did not answer';
}

/** Configuration, plus this server's own knowledge of the shared store; nothing here connects to a service. */
export default function AdminHome() {
  const redis = redisAvailability();
  const checks: Check[] = [
    {
      label: 'Article storage',
      ok: Boolean(process.env.DATABASE_URL),
      on: 'Database configured. The connection is tested when you load or save an article.',
      off: 'No database is configured.',
      consequence: 'Articles cannot be loaded, saved or published.',
    },
    {
      label: 'Administrator sign-in',
      ok: adminAuthenticationConfigured(),
      on: 'Administrator credentials are configured. Each action re-checks your permissions.',
      off: 'No administrator credentials are configured.',
      consequence: 'Deployed sign-in is closed until credentials and second factors are provisioned.',
    },
    {
      label: 'Shared store (Redis)',
      ok: redis.state === 'shared',
      badge: redis.state === 'shared' ? 'Configured' : redis.state === 'unavailable' ? 'Unavailable now' : 'Not configured',
      on: 'Upstash is configured and this server has had no recent failure, so limits and provider budgets are shared across instances.',
      off: redis.state === 'unavailable'
        ? `Upstash is configured but currently unavailable on this server (${redisReason(redis.kind)}).`
        : 'Upstash is not configured.',
      consequence: 'Reads use per-instance limits; public writes and administrator sign-in answer "try again later" until it is back.',
    },
    {
      label: 'Newsletter delivery',
      ok: Boolean(process.env.RESEND_API_KEY),
      on: 'A Resend key is configured. Delivery is confirmed per send by the provider.',
      off: 'No Resend key is configured.',
      consequence: 'Newsletter editions cannot be sent.',
    },
  ];

  return (
    <article>
      <Heading level={1} size="heading-l">Overview</Heading>
      <Text tone="muted" className="mt-2" measure>
        What this deployment is configured with. This page does not test connections; the shared store line also reflects failures this server has already seen.
      </Text>

      <section aria-labelledby="status-title" className="mt-10">
        <Label as="h2" id="status-title" size="l" tone="default">Configuration</Label>
        <ul className="mt-4 grid gap-4 md:grid-cols-2">
          {checks.map((c) => (
            <li key={c.label} className="bg-tone-raised p-5 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-text text-heading-s text-fg">{c.label}</h3>
                <StatusBadge status={c.ok ? 'finished' : 'unavailable'}>{c.badge ?? (c.ok ? 'Configured' : 'Not configured')}</StatusBadge>
              </div>
              <p className="mt-3 font-text text-small text-fg-2">{c.ok ? c.on : c.off}</p>
              {!c.ok && <p className="mt-1 font-text text-small font-[650] text-fg">{c.consequence}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sections-title" className="mt-12">
        <Label as="h2" id="sections-title" size="l" tone="default">Sections</Label>
        <div className="mt-4 bg-tone-raised p-5 md:p-6">
          <h3 className="font-text text-heading-s text-fg">Articles</h3>
          <p className="mt-2 max-w-[60ch] font-text text-small text-fg-2">
            Create and reopen drafts, publish, refine published work and return articles to draft. Every save checks the stored
            revision, so one editor cannot silently overwrite another, and article addresses never change after the first save.
          </p>
          <ArrowLink href="/admin/articles" className="mt-3">Open articles</ArrowLink>
        </div>
      </section>
    </article>
  );
}
