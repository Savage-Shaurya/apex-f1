'use client';

import { TeamError } from '@/components/teams/TeamError';

/** Catches the outage thrown by app/teams/[slug]/layout.tsx (a layout's own errors reach its parent boundary). */
export default function TeamsError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <TeamError {...props} />;
}
