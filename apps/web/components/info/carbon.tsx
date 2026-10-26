import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * Small Carbon & Light pieces shared by the live, predict, admin and info
 * pages (promote to ds). Styles live in ./carbon-light.css, which each page
 * frame imports with brand-c.css.
 */

/** The section label of the home: a short red rule, then the words in titanium capitals. */
export function Eyebrow({ children, className, tone = 'silver', as: Tag = 'p', id }: { children: ReactNode; className?: string; tone?: 'silver' | 'red'; as?: 'p' | 'h2' | 'h3' | 'span'; id?: string }) {
  return (
    <Tag id={id} className={cn('bc-label flex items-center gap-3', tone === 'red' ? 'text-[color:var(--bc-red-text)]' : 'text-[color:var(--bc-silver)]', className)}>
      <span aria-hidden className="h-[2px] w-8 shrink-0 bg-[color:var(--bc-red)]" />
      <span className="min-w-0">{children}</span>
    </Tag>
  );
}

/**
 * Inline variables for `.bcp-fit` display type: the longest word decides the
 * size, capped at `max` rem; `lg` is the column's share of the container from
 * 1024px. Use with className "bcp-fit".
 */
export function fitDisplay(text: string, { max = 8, lg = 1 }: { max?: number; lg?: number } = {}): CSSProperties {
  const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0) || 1;
  return { '--fit-w': Math.max(longest, 4), '--fit-max': max, '--fit-lg': lg } as CSSProperties;
}

/** A section opening in the home's voice: eyebrow, wide display title and an optional line under it. */
export function SectionTitle({ id, eyebrow, title, children, className, size = 'm', as: Tag = 'h2' }: { id?: string; eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; className?: string; size?: 's' | 'm' | 'l'; as?: 'h1' | 'h2' | 'h3' }) {
  // Bounded by the column too (cqi), so the longest single word (PHOTOGRAPHS) always fits whole and never breaks mid-word.
  const fs = size === 'l' ? 'text-[clamp(1.8rem,min(1.2rem+5vw,7cqi),5.5rem)]' : size === 'm' ? 'text-[clamp(1.4rem,min(1.1rem+3.4vw,8cqi),3.8rem)]' : 'text-[clamp(1.1rem,min(1rem+1.6vw,8.5cqi),2.2rem)]';
  return (
    <div className={cn('@container min-w-0', className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag id={id} className={cn('bc-display text-white [overflow-wrap:anywhere]', eyebrow ? 'mt-4' : '', fs)}>{title}</Tag>
      {children && <div className="mt-4 max-w-[60ch] text-pretty text-[1.02rem] leading-relaxed text-[color:var(--bc-silver)]">{children}</div>}
    </div>
  );
}
