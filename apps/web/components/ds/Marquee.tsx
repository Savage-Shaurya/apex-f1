import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import { MarqueeRegion } from './MarqueeRegion';

/**
 * Continuous horizontal ticker. Adapted from Magic UI's Marquee
 * (https://magicui.design, MIT, (c) Magic UI): CSS-only, no JS loop, so it
 * cannot drift from the site's single clock. Pauses on hover and focus, and while off-screen or in a hidden tab; under
 * reduced motion it becomes a static, scrollable row. Both edges fade (a CSS
 * mask in globals.css) so no headline is cut through a letter. The clone is inert
 * and hidden from assistive tech, so content is announced and focused once.
 */
export function Marquee({
  children,
  label,
  duration = 48,
  gap = '2.5rem',
  reverse = false,
  paused = false,
  className,
}: {
  children: ReactNode;
  /** Names the region for assistive tech. */
  label: string;
  /** Seconds per loop. */
  duration?: number;
  gap?: string;
  reverse?: boolean;
  /** Stops the loop (pair with a visible pause control: WCAG 2.2.2). */
  paused?: boolean;
  className?: string;
}) {
  const style = { '--marquee-duration': `${duration}s`, '--marquee-gap': gap } as CSSProperties;
  const track = cn('ds-marquee-track flex shrink-0 items-center whitespace-nowrap gap-[var(--marquee-gap)] animate-marquee', reverse && '[animation-direction:reverse]');
  return (
    <MarqueeRegion label={label} paused={paused} className={cn('ds-marquee group relative flex w-full min-w-0 gap-[var(--marquee-gap)] overflow-hidden [contain:inline-size]', className)} style={style}>
      <div className={track}>{children}</div>
      <div className={cn(track, 'ds-marquee-clone')} aria-hidden inert>
        {children}
      </div>
    </MarqueeRegion>
  );
}
