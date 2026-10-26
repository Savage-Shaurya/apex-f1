import type { CSSProperties, ElementType, ReactNode } from 'react';

/**
 * Nameplate on Anybody's width axis, set at its final width from the first
 * paint. It used to launch compressed and extend as it entered; that changed
 * the word's box (and its neighbours) after paint, so it is now static
 * (motion audit 2026-10-26: nothing moves or resizes while someone reads).
 *
 * Use on single-line display words (a surname, a circuit), with
 * `white-space: nowrap` at a size that fits the container.
 */
export function BrakeIn({ as = 'span', width = 112, children, className }: { as?: ElementType; width?: number; children: ReactNode; className?: string }) {
  const Tag = as as 'span';
  return (
    <Tag className={['wdth-var whitespace-nowrap', className].filter(Boolean).join(' ')} style={{ '--wdth': width } as CSSProperties}>
      {children}
    </Tag>
  );
}
