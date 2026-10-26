import type { ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * A Carbon & Light chapter head, as on the home page: a red rule and a small
 * label over the wide display title, with an optional aside (controls, notes)
 * on the right. Promote to ds once other pages use it.
 */
export function SectionHead({ id, label, title, aside, className, children }: { id: string; label: ReactNode; title: ReactNode; aside?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-6', className)}>
      <div className="min-w-0 max-w-full">
        <p className="bc-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 shrink-0 bg-[color:var(--bc-red)]" />{label}</p>
        <h2 id={id} className="bc-display mt-4 text-[clamp(1.9rem,4.6vw,3.6rem)] [overflow-wrap:break-word]">{title}</h2>
        {children}
      </div>
      {aside}
    </div>
  );
}
