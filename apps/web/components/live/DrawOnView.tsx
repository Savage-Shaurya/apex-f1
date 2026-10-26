import type { ReactNode } from 'react';

/**
 * Block of data bars (marked `data-draw`). The bars render at their real
 * length from the first paint; they no longer grow in as the block scrolls
 * into view (motion audit 2026-10-26: content renders in place).
 */
export function DrawOnView({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
