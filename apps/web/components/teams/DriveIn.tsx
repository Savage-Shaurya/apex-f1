import type { ReactNode } from 'react';

/**
 * Car frame on the team pages. The car renders in place from the first
 * paint (no roll-in), so the row never shifts while someone scrolls.
 */
export function DriveIn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
