import { createElement, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cn } from '@apex/ui';

/* ---------------------------------------------------------------------------
 * Type roles. Every size carries its own line-height and letter-spacing from
 * the @theme scale, so callers never set tracking by hand:
 *   - nothing under 24px is tracked negative;
 *   - running text is +0.01em, small text +0.016 to +0.02em;
 *   - uppercase labels open to +0.08 to +0.1em;
 *   - display capitals open slightly (0 to +0.005em: the heavy wide caps
 *     crowd at 100px+); sentence-case display may close by at most
 *     -0.008em, and only where it is above 48px (lg/xl up).
 * ------------------------------------------------------------------------- */

export type HeadingSize = 'display-xl' | 'display-l' | 'display-m' | 'heading-l' | 'heading-m' | 'heading-s';

const HEADING: Record<HeadingSize, string> = {
  // Anybody, set semi-wide, always in capitals at display sizes unless `caps={false}`.
  // Normal width on phones so long words fit; semi-wide from 640px.
  'display-xl': 'font-display text-display-xl font-normal-width sm:font-semi-wide',
  'display-l': 'font-display text-display-l font-normal-width sm:font-semi-wide',
  'display-m': 'font-display text-display-m font-normal-width sm:font-semi-wide',
  // Below display size the text face carries headings: Anybody's lowercase is
  // a display curiosity, and long story titles read better in Hanken.
  'heading-l': 'font-text text-heading-l',
  'heading-m': 'font-text text-heading-m',
  'heading-s': 'font-text text-heading-s',
};

/** Tracking for capitals at display sizes (capitals need more air than sentence case; smaller steps get more). */
export const CAPS_TRACKING: Partial<Record<HeadingSize, string>> = {
  'display-xl': 'uppercase tracking-[0em]',
  'display-l': 'uppercase tracking-[0.003em]',
  'display-m': 'uppercase tracking-[0.005em]',
};

/** Sentence-case display: closes by at most -0.008em, only once the step is above 48px. */
export const SENTENCE_TRACKING: Partial<Record<HeadingSize, string>> = {
  'display-xl': 'md:tracking-[-0.008em]',
  'display-l': 'lg:tracking-[-0.008em]',
  'display-m': 'xl:tracking-[-0.006em]',
};

const DEFAULT_SIZE: Record<1 | 2 | 3 | 4 | 5 | 6, HeadingSize> = {
  1: 'display-l',
  2: 'display-m',
  3: 'heading-l',
  4: 'heading-m',
  5: 'heading-s',
  6: 'heading-s',
};

export function Heading({
  level = 2,
  size,
  caps,
  tone = 'default',
  as,
  className,
  children,
  ...rest
}: {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  size?: HeadingSize;
  /** Capitals. Defaults to true for display sizes, false otherwise. Keep capital headings short (about 32 characters). */
  caps?: boolean;
  tone?: 'default' | 'muted' | 'accent';
  /** Override the element (e.g. a visually large <p> that is not a heading). */
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'h2'>, 'className' | 'children'>) {
  const resolved = size ?? DEFAULT_SIZE[level];
  const useCaps = caps ?? resolved.startsWith('display');
  return createElement(
    as ?? (`h${level}` as ElementType),
    {
      className: cn(
        HEADING[resolved],
        useCaps ? CAPS_TRACKING[resolved] : SENTENCE_TRACKING[resolved],
        tone === 'muted' ? 'text-fg-2' : tone === 'accent' ? 'text-accent' : 'text-fg',
        'text-balance',
        className,
      ),
      ...rest,
    },
    children,
  );
}

export type TextSize = 'lead' | 'body' | 'ui' | 'small' | 'caption';

const TEXT: Record<TextSize, string> = {
  lead: 'text-lead',
  body: 'text-body',
  ui: 'text-ui',
  small: 'text-small',
  caption: 'text-caption',
};

const TONE_CLASS = {
  default: 'text-fg',
  muted: 'text-fg-2',
  subtle: 'text-fg-3',
  accent: 'text-accent',
  inherit: '',
} as const;

export function Text({
  as = 'p',
  size = 'body',
  tone = 'default',
  editorial = false,
  measure = false,
  weight,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  size?: TextSize;
  tone?: keyof typeof TONE_CLASS;
  /** EB Garamond: the editorial voice, for a standfirst or pull quote only. */
  editorial?: boolean;
  /** Limit to the reading measure (68ch). */
  measure?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<'p'>, 'className' | 'children'>) {
  return createElement(
    as,
    {
      className: cn(
        TEXT[size],
        editorial ? 'ds-editorial font-editorial tracking-[0em]' : 'font-text',
        TONE_CLASS[tone],
        measure && 'max-w-[var(--measure)]',
        weight === 'medium' && 'font-medium',
        weight === 'semibold' && 'font-[650]',
        weight === 'bold' && 'font-bold',
        size !== 'ui' && 'text-pretty',
        className,
      ),
      ...rest,
    },
    children,
  );
}

/**
 * Uppercase label for table heads, data captions and metadata keys. Not an
 * eyebrow: it never sits above a heading to decorate it.
 */
export function Label({
  as = 'span',
  size = 'm',
  tone = 'muted',
  className,
  children,
  ...rest
}: { as?: ElementType; size?: 'm' | 'l'; tone?: keyof typeof TONE_CLASS; className?: string; children: ReactNode } & Omit<ComponentPropsWithoutRef<'span'>, 'className' | 'children'>) {
  return createElement(
    as,
    { className: cn('font-text uppercase', size === 'l' ? 'text-label-l' : 'text-label', TONE_CLASS[tone], className), ...rest },
    children,
  );
}

const NUMERAL = {
  'stat-xl': 'text-stat-xl',
  'stat-l': 'text-stat-l',
  'stat-m': 'text-stat-m',
  body: 'text-body font-[650]',
} as const;

/**
 * A number set for reading and comparison: Anybody at normal width with
 * tabular figures for stats, the text face for inline values. Always real
 * text (never counted up from zero).
 */
export function Numeral({
  value,
  unit,
  size = 'stat-l',
  tone = 'default',
  className,
}: { value: ReactNode; unit?: ReactNode; size?: keyof typeof NUMERAL; tone?: keyof typeof TONE_CLASS; className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-[0.18em] tabular-nums', TONE_CLASS[tone], className)}>
      <span className={cn(size === 'body' ? 'font-text' : 'font-display font-normal-width', NUMERAL[size])}>{value}</span>
      {unit ? <span className="font-text text-label uppercase text-fg-3">{unit}</span> : null}
    </span>
  );
}

/** Timing values (lap times, gaps, intervals): fixed-width figures that do not jitter while live. */
export function Timing({ children, className, tone = 'default' }: { children: ReactNode; className?: string; tone?: keyof typeof TONE_CLASS }) {
  return <span className={cn('font-timing text-[0.9375em] tracking-[0.02em] tabular-nums', TONE_CLASS[tone], className)}>{children}</span>;
}
