import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Media, type MediaCredit } from './Media';
import { Heading } from './Type';
import { Icon } from './Icon';
import type { MediaKind } from './media-rules';
import { trimSummary } from './text';

/**
 * A raised panel. Depth comes from a tone step, never a shadow or a
 * hairline box. Do not nest cards.
 */
export function Card({ children, className, padded = true, as: As = 'div' }: { children: ReactNode; className?: string; padded?: boolean; as?: 'div' | 'article' | 'section' | 'li' }) {
  return <As className={cn('relative bg-tone-raised text-fg', padded && 'p-5 md:p-6', className)}>{children}</As>;
}

export type StoryVariant = 'lead' | 'standard' | 'compact' | 'text';

/**
 * A news or video story. The whole card is one link (title is the accessible
 * name); source and time are plain text below. External stories open in a
 * new tab and say so. `meta` is preformatted by the caller (server time,
 * never a client clock) so hydration is stable.
 */
export function StoryCard({
  href,
  external = false,
  title,
  source,
  meta,
  summary,
  image,
  imageAlt,
  imageKind = 'wide',
  credit,
  tag,
  variant = 'standard',
  priority = false,
  className,
}: {
  href: string;
  external?: boolean;
  title: string;
  source?: string;
  meta?: ReactNode;
  summary?: string;
  image?: string | null;
  imageAlt?: string;
  imageKind?: MediaKind;
  credit?: MediaCredit | null;
  tag?: ReactNode;
  variant?: StoryVariant;
  priority?: boolean;
  className?: string;
}) {
  const lead = variant === 'lead';
  const compact = variant === 'compact';
  const showImage = variant !== 'text';
  const headingSize = lead ? 'heading-l' : compact ? 'heading-s' : 'heading-m';
  const LinkTag = external ? 'a' : Link;
  const linkProps = external ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href };

  return (
    <article className={cn('group/story relative min-w-0', compact ? 'grid grid-cols-[minmax(0,1fr)_7.5rem] gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]' : 'flex flex-col', className)}>
      {showImage && (
        <div className={cn('relative overflow-hidden', compact ? 'order-2' : 'mb-4')}>
          <div className="transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover/story:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover/story:scale-100">
            <Media src={image} alt={imageAlt ?? ''} kind={compact ? 'photo' : imageKind} priority={priority} sizes={lead ? '(max-width: 1024px) 100vw, 60vw' : compact ? '144px' : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw'} credit={lead ? credit : null} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        {(tag || source) && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {tag}
            {source && <span className="font-text text-small font-[650] text-fg-2">{source}</span>}
          </div>
        )}
        <Heading level={3} size={headingSize} caps={false} className="transition-colors duration-[var(--duration-base)] group-hover/story:text-accent">
          <LinkTag {...linkProps} className="after:absolute after:inset-0 focus-visible:outline-none [&:focus-visible]:underline">
            {title}
            {external && <span className="sr-only"> (opens in a new tab)</span>}
          </LinkTag>
        </Heading>
        {summary && !compact && <p className={cn('mt-3 font-text text-fg-2', lead ? 'text-lead max-w-[56ch]' : 'text-small')}>{trimSummary(summary, lead ? 320 : 180)}</p>}
        {meta && (
          <p className="mt-3 flex items-center gap-2 font-text text-caption text-fg-3">
            {meta}
            {external && <Icon name="arrow-up-right" size={14} className="text-fg-3" />}
          </p>
        )}
      </div>
    </article>
  );
}

/** A key number with its label and optional unit and footnote (source, season). */
export function Stat({ label, value, unit, note, size = 'l', className }: { label: ReactNode; value: ReactNode; unit?: ReactNode; note?: ReactNode; size?: 'xl' | 'l' | 'm'; className?: string }) {
  const valueClass = size === 'xl' ? 'text-stat-xl' : size === 'm' ? 'text-stat-m' : 'text-stat-l';
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="font-text text-label uppercase text-fg-3">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-1.5 tabular-nums">
        <span className={cn('font-display font-normal-width text-fg', valueClass)}>{value}</span>
        {unit && <span className="font-text text-label uppercase text-fg-3">{unit}</span>}
      </dd>
      {note && <dd className="mt-1.5 font-text text-caption text-fg-3">{note}</dd>}
    </div>
  );
}

/** A row of stats as one description list. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]', className)}>{children}</dl>;
}

/**
 * Quiet freshness line under a data block ("Session ended Sun 26 Oct, 22:04
 * UTC", "Final standings after round 19"). Reader language only: provider
 * names, caching and internal mechanics are not shown on pages; every source
 * and licence is credited on /references (from lib/credits.ts). `source` and
 * `href` are accepted for older callers but no longer rendered; with no
 * `updated` line nothing renders.
 */
export function SourceNote({ updated, className }: { /** @deprecated Not rendered: see /references. */ source?: ReactNode; updated?: ReactNode; /** @deprecated Not rendered. */ href?: string; className?: string }) {
  if (!updated) return null;
  return <p className={cn('font-text text-caption text-fg-3', className)}>{updated}</p>;
}
