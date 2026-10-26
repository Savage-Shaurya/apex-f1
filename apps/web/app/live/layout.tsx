import type { ReactNode } from 'react';

/**
 * The /live screens show finished sessions from free OpenF1 history. There is
 * no realtime stream (out of scope by owner decision), so no stream provider
 * is mounted and nothing on these pages claims to be live.
 */
export default function LiveLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
