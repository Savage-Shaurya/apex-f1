import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { PeopleSourceOutage } from '@/components/drivers/outage';
import { outageDuringBuild } from '@/lib/outage-connection';
import { loadConstructor } from '@/components/data/load-constructor';

/**
 * Existence gate for every team route. It runs above the profile and history
 * loading boundaries, so an unknown constructor id answers HTTP 404 before
 * any skeleton streams (a notFound() thrown inside a streamed page would ship
 * as a 200 "soft 404"). A provider outage is not a 404 either: it throws
 * PeopleSourceOutage, so the response is a 5xx with the area error boundary's
 * truthful state, and a cached ISR render keeps being served (SEO-2).
 */
export default async function TeamLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const record = await loadConstructor(slug);
  if (record.state === 'missing') notFound();
  if (record.state === 'unavailable') {
    // During `next build` a throw would fail the deploy and a dynamic bailout would end ISR for the
    // whole route (F-01/F-03): the page renders its honest unavailable state on a one-minute
    // revalidate instead. At runtime the throw keeps the last good page (ISR stale-on-error).
    if (await outageDuringBuild()) return children;
    throw new PeopleSourceOutage('The constructor record');
  }
  return children;
}
