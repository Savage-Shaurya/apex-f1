'use client';

import { useParams } from 'next/navigation';
import { DriverPageError } from '@/components/drivers/DriverPageError';

/**
 * Drivers area boundary. The [slug] layout's existence check throws on a
 * provider outage (so cached pages keep serving), and an error thrown by a
 * layout is caught one segment up, here: a driver URL gets the same designed
 * screen as the page-level boundary in app/drivers/[slug]/error.tsx.
 */
export default function DriversError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ slug?: string }>();
  return <DriverPageError error={error} retry={retry} title={params?.slug ? 'Driver page unavailable' : 'Drivers unavailable'} />;
}
