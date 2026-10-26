import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';

/** Section kicker: the red rule and a label, as on the home page. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('bc-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]', className)}>
      <span aria-hidden className="h-[2px] w-8 shrink-0 bg-[color:var(--bc-red)]" />
      {children}
    </p>
  );
}

/**
 * Advance widths (em) of the uppercase display face: Anybody at 780 weight,
 * 122% stretch and 0.01em tracking, as `.bc-display` renders it (measured in
 * Chromium). Anything not listed counts as a wide capital.
 */
const DISPLAY_ADVANCE: Record<string, number> = {
  A: 0.95, B: 0.88, C: 0.874, D: 0.869, E: 0.761, F: 0.702, G: 0.907, H: 0.895, I: 0.408, J: 0.865, K: 0.82, L: 0.681, M: 1.146,
  N: 1.007, O: 0.91, P: 0.83, Q: 0.911, R: 0.846, S: 0.878, T: 0.844, U: 0.91, V: 0.893, W: 1.295, X: 0.887, Y: 0.913, Z: 0.783,
  0: 0.776, 1: 0.741, 2: 0.797, 3: 0.8, 4: 0.776, 5: 0.786, 6: 0.796, 7: 0.718, 8: 0.784, 9: 0.796,
  '-': 0.6, '.': 0.304, '&': 1.031, "'": 0.229, '\u2019': 0.229,
};
const WIDE_CAPITAL = 1.05;
/** Room for rasterising and hinting differences between engines. */
const FIT_SAFETY = 1.03;

/** Rendered width of one word in em: CSS uppercases it, accents sit on their base letter. */
function displayWidth(word: string): number {
  let em = 0;
  for (const ch of word.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '')) em += DISPLAY_ADVANCE[ch] ?? WIDE_CAPITAL;
  return em * FIT_SAFETY;
}

/**
 * Display type fitted to its column: the size is the smaller of the preferred
 * clamp and what the widest word needs to fit `100cqi` (the parent must be a
 * size container). The width comes from the face's glyph advances, never
 * less than the length estimate (~0.92em per capital), so wide letters such
 * as M and W shrink the size and words never break mid-word.
 */
export function fitDisplay(text: string, preferred: string, stretch = 1.22): string {
  const words = text.split(/\s+|(?<=-)/u).filter(Boolean);
  const widest = Math.max(4 * 0.92, ...words.map((w) => Math.max(w.length * 0.92, displayWidth(w))));
  return `min(${preferred}, calc(100cqi / ${(widest * (stretch / 1.22)).toFixed(3)}))`;
}

/** One number on the timing sheet: a label over a mono value, an optional note under it. */
export function Readout({ label, value, note, size = 'm', count, className }: { label: string; value: ReactNode; note?: ReactNode; size?: 's' | 'm' | 'l'; count?: number; className?: string }) {
  const text = size === 'l' ? 'text-[clamp(2rem,4.2vw,3.4rem)]' : size === 'm' ? 'text-[clamp(1.6rem,2.6vw,2.2rem)]' : 'text-[1.35rem]';
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="bc-label text-[0.68rem] text-[color:var(--bc-titanium)]">{label}</dt>
      <dd className={cn('bc-mono mt-2 leading-none text-[color:var(--bc-white)]', text)}>
        {count !== undefined ? <span data-count={count}>{value}</span> : value}
      </dd>
      {note ? <dd className="mt-2 text-[0.82rem] leading-snug text-[color:var(--bc-silver)]">{note}</dd> : null}
    </div>
  );
}

/** Profile / History switch for one team. */
export function TeamTabs({ slug, current }: { slug: string; current: 'profile' | 'history' }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'relative inline-flex min-h-11 items-center px-1 text-[0.9rem] font-semibold transition-colors',
        on ? 'text-[color:var(--bc-white)] after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-silver)] hover:text-white',
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="Team pages" className="flex gap-6 border-b border-[color:var(--bc-rule)]">
      {tab(`/teams/${slug}`, 'Profile', current === 'profile')}
      {tab(`/teams/${slug}/history`, 'History', current === 'history')}
    </nav>
  );
}

/** Year runs that wrap only between runs, never inside "1999–2004". */
export function Runs({ text }: { text: string }) {
  const runs = text.split(', ').filter(Boolean);
  return (
    <>
      {runs.map((r, i) => (
        <span key={r}>
          <span className="whitespace-nowrap">{r}{i < runs.length - 1 ? ',' : ''}</span>
          {i < runs.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

/** A thin team-colour bar (data, never decoration): length is the value's share. */
export function ShareBar({ share, color, label, className, delayMs = 0 }: { share: number; color: string; label?: string; className?: string; delayMs?: number }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  return (
    <div className={cn('relative h-[3px] w-full overflow-hidden rounded-full bg-white/[0.08]', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <span className="tc-grow-x absolute inset-y-0 left-0 block rounded-full" style={{ width: `${pct.toFixed(2)}%`, backgroundColor: color, '--d': `${delayMs}ms` } as CSSProperties} />
    </div>
  );
}
