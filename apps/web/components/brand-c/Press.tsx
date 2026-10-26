import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * The hero's buttons: pill links that lift a touch on hover and press in on
 * tap (transform only, a springy ease). Still under reduced motion. Plain CSS,
 * so the server HTML and the hydrated button are identical.
 */
export function PressLink({ href, variant, children, className }: { href: string; variant: 'solid' | 'ghost'; children: ReactNode; className?: string }) {
  const look = variant === 'solid'
    ? 'bg-[color:var(--bc-white)] font-semibold text-[color:var(--bc-night)] hover:bg-white'
    : 'font-medium text-[color:var(--bc-white)] ring-1 ring-white/30 hover:ring-white/60 hover:bg-white/[0.04]';
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] transition-[transform,background-color,box-shadow,color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.96] active:duration-100 motion-reduce:transform-none motion-reduce:transition-colors',
        look,
        className,
      )}
    >
      {children}
    </Link>
  );
}
