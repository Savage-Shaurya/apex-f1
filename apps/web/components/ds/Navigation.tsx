import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Icon } from './Icon';

/** Location trail for deep routes (season > race > session). The last item is the current page. */
export function Breadcrumbs({ items, className }: { items: { label: ReactNode; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 font-text text-small text-fg-3">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-fg hover:underline">{item.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn('min-w-0 [overflow-wrap:anywhere]', last && 'text-fg-2')}>{item.label}</span>
              )}
              {!last && <span aria-hidden className="text-fg-3">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Previous / next pagination with the current page stated in words. */
export function Pagination({ page, totalPages, hrefFor, className }: { page: number; totalPages: number; hrefFor: (page: number) => string; className?: string }) {
  if (totalPages <= 1) return null;
  const link = 'inline-flex min-h-11 items-center gap-2 px-4 font-text text-ui font-[650] text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-colors hover:bg-tone-hover';
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-4', className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={link}>
          <Icon name="arrow-left" size={18} />
          Newer
        </Link>
      ) : <span />}
      <p className="font-text text-small text-fg-2">
        Page {page} of {totalPages}
      </p>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} rel="next" className={link}>
          Older
          <Icon name="arrow-right" size={18} />
        </Link>
      ) : <span />}
    </nav>
  );
}
