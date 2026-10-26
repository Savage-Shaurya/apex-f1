import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * Carbon & Light pieces shared by the news, video, search and newsletter
 * pages (promote to ds with FilterRail when the shared layer reopens).
 * Same grammar as the home page: a red rule before every label, the wide
 * display face for titles, pill actions, floodlight from above.
 */

/** "— PADDOCK WIRE · 42 STORIES": the label that opens every section on the home page. */
export function Kicker({ children, className, as: As = 'p', id }: { children: ReactNode; className?: string; as?: 'p' | 'h2' | 'h3' | 'span'; id?: string }) {
  return (
    <As id={id} className={cn('bc-label flex items-center gap-3 text-[color:var(--bc-silver)]', className)}>
      <span aria-hidden className="h-[2px] w-8 shrink-0 bg-[color:var(--bc-red)]" />
      <span className="min-w-0">{children}</span>
    </As>
  );
}

/** Em-widths the longest word needs in the wide display face (uppercase Anybody at 122%, about 0.96em a letter). */
function fitFactor(title: ReactNode): number {
  const text = typeof title === 'string' ? title : 'MMMMMM';
  const longest = Math.max(4, ...text.split(/\s+/).map((w) => w.length));
  return Math.round(longest * 0.98 * 100) / 100;
}

/**
 * Page masthead: the floodlight lands on the title from above (static CSS
 * light, the same subject as the home hero's rays), with the page's one
 * factual line beside it. `light` lets a page put its own stage behind it.
 */
export function Masthead({ kicker, title, children, light, className }: { kicker: ReactNode; title: ReactNode; children?: ReactNode; light?: ReactNode; className?: string }) {
  return (
    <header className={cn('relative isolate overflow-hidden', className)}>
      <div aria-hidden className="absolute inset-0 -z-10">
        {light ?? <div className="bc-flood-static absolute inset-0" />}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-[color:var(--bc-night)]" />
      </div>
      <div className="ds-container pb-10 pt-[clamp(2.5rem,6vw,5.5rem)] md:pb-14">
        <Kicker className="bc-in-up" >{kicker}</Kicker>
        <div className="mt-5 grid items-end gap-x-10 gap-y-6 lg:grid-cols-12">
          {/* Fitted to its column by the longest word (container units), so a title never breaks mid-word at any width. */}
          <div className="@container min-w-0 lg:col-span-7">
            <h1 className="bc-display bc-mask" style={{ fontSize: `min(9rem, calc(100cqi / ${fitFactor(title)}))` }}>
              <span className="bc-in-rise">{title}</span>
            </h1>
          </div>
          {children && <div className="bc-in-up min-w-0 lg:col-span-5 lg:pb-3" style={{ '--d': '180ms' } as React.CSSProperties}>{children}</div>}
        </div>
      </div>
    </header>
  );
}

/** Pill action, the hero's buttons (solid white or a hairline ghost). External links open a new tab and say so. */
export function PillLink({ href, children, variant = 'ghost', external = false, className, ...rest }: { href: string; children: ReactNode; variant?: 'solid' | 'ghost' | 'red'; external?: boolean; className?: string } & Record<`data-${string}`, string | undefined>) {
  const look = variant === 'solid'
    ? 'bg-[color:var(--bc-white)] font-semibold text-[color:var(--bc-night)] hover:bg-white'
    : variant === 'red'
      ? 'bg-[color:var(--bc-red)] font-semibold text-white hover:bg-[#f01a12]'
      : 'font-medium text-[color:var(--bc-white)] ring-1 ring-white/30 hover:bg-white/[0.04] hover:ring-white/60';
  const cls = cn(
    'inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] transition-[transform,background-color,box-shadow,color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96] active:duration-100 motion-reduce:transform-none motion-reduce:transition-colors',
    look,
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return <Link href={href} className={cls} {...rest}>{children}</Link>;
}

/** Newer / Older between pages of a list, in pills, with the position in timing figures. */
export function Pager({ page, totalPages, hrefFor, className }: { page: number; totalPages: number; hrefFor: (page: number) => string; className?: string }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-4', className)}>
      {page > 1 ? <PillLink href={hrefFor(page - 1)}><span aria-hidden>←</span> Newer</PillLink> : <span />}
      <p className="bc-mono text-[0.85rem] text-[color:var(--bc-silver)]">
        <span className="sr-only">Page </span>{String(page).padStart(2, '0')}<span className="text-[color:var(--bc-titanium)]"> / {String(totalPages).padStart(2, '0')}</span>
      </p>
      {page < totalPages ? <PillLink href={hrefFor(page + 1)}>Older <span aria-hidden>→</span></PillLink> : <span />}
    </nav>
  );
}

/**
 * An honest empty or unavailable state in Carbon & Light: a lit carbon
 * panel that says what is true and offers a real way on. Never a
 * placeholder, never a fake.
 */
export function CarbonNotice({ title, children, action, tone = 'empty', className, headingLevel = 2 }: { title: string; children: ReactNode; action?: { label: string; href: string }; tone?: 'empty' | 'unavailable'; className?: string; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div role={tone === 'unavailable' ? 'status' : undefined} className={cn('relative overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] p-7 ring-1 ring-white/10 md:p-10', className)}>
      <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
      <div aria-hidden className="absolute -top-24 left-10 h-48 w-2/3 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.08),transparent)]" />
      <div className="relative">
        <p className="bc-label flex items-center gap-3 text-[color:var(--bc-titanium)]">
          <span aria-hidden className={cn('h-[2px] w-8', tone === 'unavailable' ? 'bg-[color:var(--bc-red)]' : 'bg-white/40')} />
          {tone === 'unavailable' ? 'Unavailable right now' : 'Nothing here yet'}
        </p>
        <H className="bc-wide mt-4 text-[clamp(1.35rem,2.4vw,1.9rem)] leading-tight">{title}</H>
        <div className="mt-3 max-w-[56ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">{children}</div>
        {action && <PillLink href={action.href} variant="solid" className="mt-6">{action.label} <span aria-hidden>→</span></PillLink>}
      </div>
    </div>
  );
}
