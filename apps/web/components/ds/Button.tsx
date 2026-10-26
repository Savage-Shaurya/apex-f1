import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'inverse' | 'ghost';
export type ButtonSize = 'md' | 'lg';

/**
 * Buttons are square-cornered and flat (decided once for the whole site).
 * Primary is the start-light red and appears once per view. Labels are
 * sentence case in the text face; they wrap rather than clip.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-red text-white hover:bg-brand-red-hover active:bg-brand-red-press',
  // Outline in the tone's strong rule; works on carbon, paper and red.
  secondary: 'text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)] hover:shadow-[inset_0_0_0_1px_var(--fg)] hover:bg-tone-hover',
  // Chalk on carbon, carbon on paper.
  inverse: 'bg-fg text-tone hover:opacity-90',
  ghost: 'text-fg hover:bg-tone-hover',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-11 px-5 py-2.5 text-ui gap-2.5',
  lg: 'min-h-13 px-7 py-3 text-[1.0625rem] leading-[1.3] tracking-[0.01em] gap-3',
};

export function buttonClasses({ variant = 'primary', size = 'md', cut = false, block = false, className }: { variant?: ButtonVariant; size?: ButtonSize; cut?: boolean; block?: boolean; className?: string } = {}) {
  return cn(
    'group/button relative inline-flex max-w-full items-center justify-center text-center font-text font-[650] whitespace-normal [overflow-wrap:anywhere]',
    'transition-[background-color,box-shadow,color,opacity,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    'active:scale-[0.98] motion-reduce:active:scale-100',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45',
    VARIANT[variant],
    SIZE[size],
    cut && 'ds-chamfer pr-[calc(1.75rem+6px)] [--cut:10px]',
    block && 'w-full',
    className,
  );
}

function Trailing({ icon }: { icon?: IconName | false }) {
  if (!icon) return null;
  return (
    <Icon
      name={icon}
      size={18}
      className="shrink-0 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover/button:translate-x-0.5 group-focus-visible/button:translate-x-0.5 motion-reduce:transition-none"
    />
  );
}

type Shared = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The original spec's machined corner. Hero call to action only. */
  cut?: boolean;
  block?: boolean;
  /** Trailing icon. Defaults to none for buttons, an arrow for links. */
  icon?: IconName | false;
  leadingIcon?: IconName;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant,
  size,
  cut,
  block,
  icon = false,
  leadingIcon,
  loading = false,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: Shared & { loading?: boolean } & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'>) {
  // While loading the button stays focusable (aria-disabled, not disabled):
  // disabling a focused control would drop keyboard focus to <body>. Clicks,
  // and the implicit form submission that Enter triggers through this click,
  // are cancelled instead.
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      {...rest}
      aria-disabled={loading || rest['aria-disabled'] || undefined}
      onClick={(event) => {
        if (loading) { event.preventDefault(); return; }
        onClick?.(event);
      }}
      className={buttonClasses({ variant, size, cut, block, className })}
    >
      {leadingIcon && <Icon name={leadingIcon} size={18} className="shrink-0" />}
      <span className={cn(loading && 'opacity-0')}>{children}</span>
      {loading && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <span className="h-0.5 w-8 animate-[lights-pulse_1.2s_ease-in-out_infinite] bg-current motion-reduce:animate-none" />
        </span>
      )}
      {!loading && <Trailing icon={icon} />}
    </button>
  );
}

/**
 * A link styled as a button. Internal hrefs use next/link; `external` opens a
 * new tab with an up-right arrow and an accessible "(opens in a new tab)".
 */
export function ButtonLink({
  href,
  external = false,
  variant,
  size,
  cut,
  block,
  icon,
  leadingIcon,
  className,
  children,
  ...rest
}: Shared & { href: string; external?: boolean } & Omit<ComponentPropsWithoutRef<'a'>, 'className' | 'children' | 'href'>) {
  const cls = buttonClasses({ variant, size, cut, block, className });
  const trailing = icon === undefined ? (external ? 'arrow-up-right' : 'arrow-right') : icon;
  const inner = (
    <>
      {leadingIcon && <Icon name={leadingIcon} size={18} className="shrink-0" />}
      <span>{children}</span>
      {external && <span className="sr-only"> (opens in a new tab)</span>}
      <Trailing icon={trailing} />
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>{inner}</a>
  ) : (
    <Link href={href} className={cls} {...rest}>{inner}</Link>
  );
}

/**
 * Standalone text link with a travelling arrow (section "see all", footer).
 * Inline links inside prose use <TextLink>.
 */
export function ArrowLink({ href, external = false, className, children }: { href: string; external?: boolean; className?: string; children: ReactNode }) {
  const cls = cn(
    'group/arrow inline-flex min-h-11 max-w-full items-center gap-2 font-text text-ui font-[650] text-fg',
    'underline decoration-transparent decoration-2 underline-offset-[6px] transition-[text-decoration-color,color] duration-[var(--duration-base)] hover:decoration-[var(--accent-text)] focus-visible:decoration-[var(--accent-text)]',
    className,
  );
  const inner = (
    <>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      {external && <span className="sr-only"> (opens in a new tab)</span>}
      <Icon name={external ? 'arrow-up-right' : 'arrow-right'} size={18} className="shrink-0 text-accent transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover/arrow:translate-x-1 motion-reduce:transition-none" />
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
  ) : (
    <Link href={href} className={cls}>{inner}</Link>
  );
}

/** Inline link inside running text: always underlined, accent on hover. */
export function TextLink({ href, external = false, className, children }: { href: string; external?: boolean; className?: string; children: ReactNode }) {
  const cls = cn('text-fg underline decoration-[var(--rule-strong)] decoration-1 underline-offset-[0.18em] transition-colors hover:decoration-[var(--accent-text)] hover:text-accent', className);
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link href={href} className={cls}>{children}</Link>
  );
}
