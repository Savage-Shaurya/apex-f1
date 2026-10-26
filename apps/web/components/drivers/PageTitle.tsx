import type { ReactNode } from 'react';
import { Heading } from '@/components/ds';
import { fitSize } from './fit';

/**
 * The page h1 at display-l, capped so its longest word always fits the
 * column (heavy semi-wide capitals: "CONSTRUCTORS" is wider than a 7-column
 * desktop column at 104px). Words never break; the size steps down instead.
 */
export function PageTitle({ text, children, className }: { text: string; children?: ReactNode; className?: string }) {
  return (
    <div style={{ containerType: 'inline-size' }} className={className}>
      <Heading level={1} size="display-l" style={{ fontSize: fitSize(text, 'var(--text-display-l)', { stretch: 1.12 }) }}>
        {children ?? text}
      </Heading>
    </div>
  );
}
