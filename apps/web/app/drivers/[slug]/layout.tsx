import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { PeopleSourceOutage } from '@/components/drivers/outage';
import { loadDriver } from '@/components/data/load-driver';
import { outageDuringBuild } from '@/lib/outage-connection';

/**
 * Existence gate for every driver route. It runs above the profile and career
 * loading boundaries, so an unknown driver id answers HTTP 404 before any
 * skeleton streams (a notFound() thrown inside a streamed page would ship as
 * a 200 "soft 404"). A provider outage is not a 404: it throws, so an ISR
 * page cached while the data was healthy keeps serving its last good render,
 * and an uncached one shows the designed error screen (app/drivers/error.tsx).
 */
export default async function DriverLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await loadDriver(slug);
  if (record.state === 'missing') notFound();
  if (record.state === 'unavailable') {
    // During `next build` a throw would fail the deploy and a dynamic bailout would end ISR for the
    // whole route (F-01/F-03): the page renders its honest unavailable state on a one-minute
    // revalidate instead. At runtime the throw keeps a cached good copy serving (ISR stale-on-error).
    if (await outageDuringBuild()) return children;
    throw new PeopleSourceOutage('The driver record');
  }
  return children;
}
