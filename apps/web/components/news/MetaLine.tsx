import { cn } from '@apex/ui';

/**
 * A line of facts ("Autosport · 2 hr ago", "FORMULA 1 · 4:12 · 152K views")
 * that wraps cleanly on narrow screens.
 *
 * Each item draws its own "·" in the flex gap to its left. The line clips
 * horizontally (overflow-x: clip, never a scroll box), so the separator of
 * whichever item starts a line falls outside the left edge and is hidden:
 * a wrapped line never starts or ends with a stray "·". The separator is
 * decorative (empty alt text in `content`), so screen readers hear only
 * the facts. Vertical overflow stays visible, so nothing is cut.
 */
export function MetaLine({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 [overflow-x:clip] [overflow-y:visible] text-[0.8rem] text-[color:var(--bc-titanium,#9b9ea7)]', className)}>
      {children}
    </p>
  );
}

/** One fact in a MetaLine. Its separator sits in the gap before it. */
export function MetaItem({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "relative min-w-0 before:pointer-events-none before:absolute before:right-full before:top-0 before:w-4 before:text-center before:font-normal before:text-[color:var(--bc-graphite,#5d6068)] before:[content:'·'_/_'']",
        className,
      )}
    >
      {children}
    </span>
  );
}
