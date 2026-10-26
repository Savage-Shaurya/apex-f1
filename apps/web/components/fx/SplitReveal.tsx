import type { ReactNode } from 'react';
import type { TextTag } from './tags';

export interface SplitRevealProps {
  as?: TextTag;
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Display headline. It renders in place, at full layout and fully visible,
 * from the first paint: no masked line rise, no width settle and no hidden
 * "pending" state (motion audit 2026-10-26), so the heading never shifts
 * and assistive tech reads the real text as written.
 */
export function SplitReveal({ as = 'div', children, className, id }: SplitRevealProps) {
  const Tag = as;
  return <Tag id={id} className={className}>{children}</Tag>;
}
