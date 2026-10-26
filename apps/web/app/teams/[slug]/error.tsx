'use client';

import { TeamError } from '@/components/teams/TeamError';

/** Route-level boundary for /teams/[slug] and /teams/[slug]/history: errors from the profile and history pages. */
export default function TeamPageError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <TeamError {...props} />;
}
