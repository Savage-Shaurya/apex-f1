import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@apex/ui';

export interface FilterItem {
  href: string;
  label: ReactNode;
  /** Real count of matching items on this render. */
  count?: number;
  current?: boolean;
  /** Short qualifier read with the label, e.g. "delayed". */
  note?: string;
}

/**
 * Shared look of one filter chip (a link here, a toggle button on /search):
 * a Carbon & Light pill. At rest a hairline ring; the chosen one is lit
 * (white, night text). Press springs in a touch (transform only, still
 * under reduced motion). 44px tall for touch.
 */
export const filterItemClass = cn(
  'relative inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.88rem] font-semibold text-[color:var(--bc-silver,#c9ccd3)] ring-1 ring-white/[0.14]',
  'transition-[background-color,color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:text-white hover:ring-white/40 active:scale-[0.97] motion-reduce:transform-none',
  'aria-[current=page]:bg-[color:var(--bc-white,#f4f5f7)] aria-[current=page]:text-[color:var(--bc-night,#050506)] aria-[current=page]:ring-transparent',
  'aria-pressed:bg-[color:var(--bc-white,#f4f5f7)] aria-pressed:text-[color:var(--bc-night,#050506)] aria-pressed:ring-transparent',
  '[&_[data-count]]:text-[color:var(--bc-titanium,#9b9ea7)] aria-[current=page]:[&_[data-count]]:text-[#3d3f46] aria-pressed:[&_[data-count]]:text-[#3d3f46]',
);

/**
 * Route filter row (promote to ds as `FilterLinks`).
 *
 * Real links (shareable URLs), the current one marked `aria-current`. The
 * row wraps onto a second line instead of scrolling sideways, so it never
 * holds a hidden scroll position or catches the wheel: a vertical wheel or
 * swipe over it always scrolls the page. Padding keeps the focus ring
 * clear of the row edge (audit A11Y-5).
 */
export function FilterRail({ label, title, items, className }: { label: string; title?: string; items: FilterItem[]; className?: string }) {
  return (
    <nav aria-label={label} className={cn('flex min-w-0 items-start gap-x-4 py-2.5', className)}>
      {title && (
        <span className="bc-label hidden min-h-11 w-[5.5rem] shrink-0 items-center text-[color:var(--bc-titanium,#9b9ea7)] sm:flex" aria-hidden>
          {title}
        </span>
      )}
      <ul className="flex min-w-0 flex-1 flex-wrap gap-2 p-0.5">
        {items.map((item) => (
          <li key={item.href} className="min-w-0">
            <Link href={item.href} scroll={false} aria-current={item.current ? 'page' : undefined} className={filterItemClass}>
              <span>{item.label}</span>
              {typeof item.count === 'number' && <span data-count className="bc-mono text-[0.76rem]">{item.count}</span>}
              {item.note && <span className="text-[0.76rem]">({item.note})</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Scroll margin for every link and button under a sticky rail (StickyRail): the full
 * header height (the header slides back in when the reader moves up the
 * page) plus the rail's measured height.
 */
export const stickyRailScrollMargin = '[&_a]:scroll-mt-[calc(var(--header-h,64px)+var(--sticky-rail-h,0px)+1rem)] [&_button]:scroll-mt-[calc(var(--header-h,64px)+var(--sticky-rail-h,0px)+1rem)]';
