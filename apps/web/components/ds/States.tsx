import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Icon } from './Icon';
import { ButtonLink } from './Button';

/** Placeholder block with the page's real dimensions, so nothing shifts on load. */
export function Skeleton({ className, label }: { className?: string; label?: string }) {
  return <span role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('ds-skeleton block', className)} />;
}

/** Text-shaped skeleton: N lines, the last one shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="ds-skeleton block h-[0.9em]" style={{ width: i === lines - 1 ? '62%' : '100%' }} />
      ))}
    </span>
  );
}

/**
 * Truthful "this data is not available" state. Say what is missing and offer
 * the real next step, in reader language: no provider names, caching or
 * internal mechanics (those live on /references). Never substitute invented
 * values. `source` is accepted for older callers but no longer rendered.
 */
export function Unavailable({
  title,
  children,
  action,
  compact = false,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  /** @deprecated Not rendered: provenance lives on /references. */
  source?: ReactNode;
  action?: { label: string; href: string };
  compact?: boolean;
  className?: string;
}) {
  return (
    <div role="status" className={cn('flex gap-4 bg-tone-raised text-fg', compact ? 'p-4' : 'p-6 md:p-8', className)}>
      <Icon name="info" size={compact ? 20 : 24} className="mt-0.5 shrink-0 text-fg-3" />
      <div className="min-w-0">
        <p className={cn('font-text font-[650] text-fg', compact ? 'text-ui' : 'text-heading-s')}>{title}</p>
        {children && <div className="mt-1.5 max-w-[60ch] font-text text-small text-fg-2">{children}</div>}
        {action && (
          <div className="mt-4">
            <ButtonLink href={action.href} variant="secondary" size="md">{action.label}</ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}

/** Empty result (a filter with no matches, a season with no races yet). */
export function EmptyState({ title, children, action, className }: { title: ReactNode; children?: ReactNode; action?: { label: string; href: string }; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-3 py-10', className)}>
      <p className="font-text text-heading-l text-fg">{title}</p>
      {children && <div className="max-w-[56ch] font-text text-body text-fg-2">{children}</div>}
      {action && <ButtonLink href={action.href} variant="secondary">{action.label}</ButtonLink>}
    </div>
  );
}
