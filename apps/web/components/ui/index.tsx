import Link from 'next/link';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import type { TextTag } from '@/components/fx/tags';
import { cn } from '@apex/ui';
import { SplitReveal } from '@/components/fx/SplitReveal';

/** Page-width frame: 1680px max, fluid side padding. */
export function Container({ as = 'div', className, children }: { as?: TextTag; className?: string; children: ReactNode }) {
  return createElement(as, { className: cn('apex-container', className) }, children);
}

/** Mono label. `red` for the one accent, otherwise muted. */
export function Eyebrow({ children, red = false, className, as = 'p' }: { children: ReactNode; red?: boolean; className?: string; as?: TextTag }) {
  return createElement(as, { className: cn('font-data text-[11px] font-medium uppercase tracking-[0.2em]', red ? 'text-telemetry-red' : 'text-on-surface-variant', className) }, children);
}

/**
 * Section title row: optional index + eyebrow, a masked display title and
 * an optional trailing action. The title reveals line by line on scroll.
 */
export function SectionHeader({
  title,
  eyebrow,
  index,
  action,
  className,
  size = 'huge',
  id,
  lede,
}: {
  title: ReactNode;
  /** Editorial one-liner in EB Garamond under the title. */
  lede?: ReactNode;
  eyebrow?: ReactNode;
  index?: string;
  action?: { label: string; href: string };
  className?: string;
  size?: 'giant' | 'huge' | 'title';
  id?: string;
}) {
  const sizeClass = size === 'giant' ? 'text-giant' : size === 'title' ? 'text-title' : 'text-huge';
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-5', className)}>
      <div className="min-w-0">
        {(index || eyebrow) && (
          <div className="mb-4 flex items-center gap-3 font-data text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
            {index && <span className="text-telemetry-red">{index}</span>}
            {index && eyebrow && <span className="h-px w-8 bg-outline-variant" />}
            {eyebrow && <span>{eyebrow}</span>}
          </div>
        )}
        <SplitReveal as="h2" id={id} className={cn('font-display font-extrabold uppercase text-on-background', sizeClass)}>
          {title}
        </SplitReveal>
        {lede && <p className="mt-4 max-w-2xl font-editorial text-[clamp(1.2rem,1.7vw,1.6rem)] leading-snug text-on-surface-variant">{lede}</p>}
      </div>
      {action && <ArrowLink href={action.href}>{action.label}</ArrowLink>}
    </header>
  );
}

/** Text link with a travelling arrow. */
export function ArrowLink({ href, children, className, external = false }: { href: string; children: ReactNode; className?: string; external?: boolean }) {
  const inner = (
    <>
      <span className="link-draw min-w-0 whitespace-normal [overflow-wrap:anywhere]">{children}</span>
      <span aria-hidden className="inline-block shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1.5">→</span>
    </>
  );
  const cls = cn('group inline-flex min-h-11 max-w-full items-center gap-2 font-data text-[12px] uppercase tracking-[0.18em] text-on-background hover:text-telemetry-red', className);
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
  ) : (
    <Link href={href} className={cls}>{inner}</Link>
  );
}

type ButtonVariant = 'primary' | 'ghost' | 'light';
const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-telemetry-red text-white hover:bg-[#ff1a10]',
  ghost: 'border border-white/20 text-on-background hover:border-telemetry-red hover:text-white',
  light: 'bg-chalk text-background hover:bg-white',
};

/** Chamfered button-link. Longer labels wrap inside the available width. */
export function ButtonLink({ href, children, variant = 'primary', className, ...rest }: { href: string; children: ReactNode; variant?: ButtonVariant; className?: string } & Omit<ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link
      href={href}
      className={cn('chamfer group inline-flex min-h-12 items-center gap-3 max-w-full whitespace-normal [overflow-wrap:anywhere] px-6 font-data text-[12px] font-medium uppercase tracking-[0.18em] transition-colors duration-300', BUTTON[variant], className)}
      {...rest}
    >
      {children}
      <span aria-hidden className="shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1">→</span>
    </Link>
  );
}

/** Team-colour bar. Colour is data, so it is never used decoratively. */
export function TeamStripe({ color, className, vertical = true }: { color: string; className?: string; vertical?: boolean }) {
  return <span aria-hidden className={cn('block shrink-0', vertical ? 'w-1 self-stretch' : 'h-1 w-10', className)} style={{ backgroundColor: color }} />;
}

/** Red/white rumble-strip seam. */
export function Kerb({ className, thin = false }: { className?: string; thin?: boolean }) {
  return <div aria-hidden className={cn('kerb w-full', thin && 'kerb-thin', className)} />;
}

/** Truthful inline status for an unavailable data source. */
export function Unavailable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn('border border-dashed border-white/15 px-5 py-6 text-sm text-on-surface-variant', className)}>
      {children}
    </p>
  );
}
