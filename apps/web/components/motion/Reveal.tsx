import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

/**
 * Section group. Content renders in place, at full layout and fully visible,
 * from the first paint: no rise, no fade, no visibility change, so nothing
 * shifts while someone scrolls and keyboard and screen-reader users never
 * meet a waiting item (motion audit 2026-10-26: readers saw cards and
 * headshots "come from the bottom and shift up").
 *
 * Children may keep their `data-reveal` / `data-rise` markers; they are inert
 * hooks the design system can style later.
 */
export function Reveal({
  as = 'div',
  children,
  className,
  ...rest
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>) {
  // Typed as a div so JSX accepts children; any block element works at runtime.
  const Tag = as as 'div';
  return <Tag className={className} {...rest}>{children}</Tag>;
}
