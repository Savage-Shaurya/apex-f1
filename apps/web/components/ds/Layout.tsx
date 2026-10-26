import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@apex/ui';

export type Tone = 'carbon' | 'raised' | 'deep' | 'paper' | 'red';

const TONE: Record<Tone, string> = {
  carbon: 'tone-carbon',
  raised: 'tone-raised',
  deep: 'tone-deep',
  paper: 'tone-paper',
  red: 'tone-red',
};

/**
 * Page frame: one pair of equal outer margins at every width (16px phone,
 * 24px tablet, 32-56px desktop), 1680px maximum.
 * `size="text"` narrows to the reading measure (68ch) for article bodies.
 */
export function Container({
  as = 'div',
  size = 'default',
  className,
  children,
  ...rest
}: { as?: ElementType; size?: 'default' | 'text'; className?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>) {
  return createElement(
    as,
    { className: cn('ds-container', size === 'text' && 'max-w-[calc(var(--measure)+2*var(--page-margin))]', className), ...rest },
    children,
  );
}

const SPACING = {
  none: '',
  tight: 'py-[var(--space-block)]',
  default: 'py-[var(--space-section)]',
  loose: 'py-[calc(var(--space-section)*1.25)]',
} as const;

/**
 * A chapter of the page. `tone` switches the whole field (carbon programme,
 * paper timing sheet, red); every ds primitive inside reads its colours
 * from the tone, so nothing needs a dark/light variant.
 */
export function Section({
  as = 'section',
  tone,
  spacing = 'default',
  bleed = false,
  className,
  innerClassName,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: Tone;
  spacing?: keyof typeof SPACING;
  /** Skip the inner Container (for full-bleed media or custom frames). */
  bleed?: boolean;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'section'>, 'className' | 'children'>) {
  return createElement(
    as,
    { className: cn('relative', tone && TONE[tone], SPACING[spacing], className), ...rest },
    bleed ? children : <Container className={innerClassName}>{children}</Container>,
  );
}

/** 4 / 8 / 12-column grid with the page gutter. Place children with col-span utilities. */
export function Grid({ as = 'div', className, children, ...rest }: { as?: ElementType; className?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>) {
  return createElement(as, { className: cn('ds-grid', className), ...rest }, children);
}

/** Tone wrapper without section spacing (cards, panels, inline blocks). */
export function ToneBox({ tone, as = 'div', className, children, ...rest }: { tone: Tone; as?: ElementType; className?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<'div'>, 'className' | 'children'>) {
  return createElement(as, { className: cn(TONE[tone], className), ...rest }, children);
}
