'use client';

import { DriverPageError } from '@/components/drivers/DriverPageError';

/** Error boundary of the driver profile and career pages (their own render). */
export default function DriverRouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DriverPageError error={error} retry={retry} />;
}
