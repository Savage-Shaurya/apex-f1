import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { normalizeHex } from './color';

/* ---------------------------------------------------------------------------
 * Tags, statuses and F1 data marks. Colour never carries meaning alone: each
 * mark has a visible word or letter, and a full name for assistive tech.
 * ------------------------------------------------------------------------- */

const TAG = {
  neutral: 'bg-tone-raised text-fg',
  outline: 'text-fg-2 shadow-[inset_0_0_0_1px_var(--rule-strong)]',
  red: 'bg-brand-red text-white',
  inverse: 'bg-fg text-tone',
} as const;

/** Category or source label. Sentence case, readable size, square. */
export function Tag({ children, variant = 'neutral', className }: { children: ReactNode; variant?: keyof typeof TAG; className?: string }) {
  return (
    <span className={cn('inline-flex min-h-6 max-w-full items-center px-2 py-0.5 font-text text-caption font-[650] [overflow-wrap:anywhere]', TAG[variant], className)}>
      {children}
    </span>
  );
}

export type SessionStatus = 'live' | 'next' | 'upcoming' | 'finished' | 'delayed' | 'cancelled' | 'snapshot' | 'unavailable';

const STATUS: Record<SessionStatus, { label: string; text: string; mark?: string }> = {
  live: { label: 'Live', text: 'text-fg', mark: 'bg-brand-red' },
  next: { label: 'Next', text: 'text-fg', mark: 'bg-brand-red' },
  upcoming: { label: 'Upcoming', text: 'text-fg-2' },
  finished: { label: 'Finished', text: 'text-fg-2' },
  delayed: { label: 'Delayed', text: 'text-fg', mark: 'bg-caution' },
  cancelled: { label: 'Cancelled', text: 'text-fg-2' },
  snapshot: { label: 'Snapshot', text: 'text-fg-2' },
  unavailable: { label: 'Unavailable', text: 'text-fg-3' },
};

/**
 * Session or feed status, always in words. Statuses that need the reader's
 * attention (live, next, delayed) add a short upright rule before the word:
 * a shape, not a dot, and never animated. `data-status` is the hook for the
 * design system to restyle any state. `live` must only be used when a live
 * provider confirms the session is running right now; use `snapshot` for
 * cached or delayed data.
 */
export function StatusBadge({ status, children, className }: { status: SessionStatus; children?: ReactNode; className?: string }) {
  const s = STATUS[status];
  return (
    <span data-status={status} className={cn('inline-flex items-center gap-2 font-text text-label uppercase', s.text, className)}>
      {s.mark && <span aria-hidden className={cn('h-[1.1em] w-[3px] shrink-0', s.mark)} />}
      {children ?? s.label}
    </span>
  );
}

/** Team colour as data: a stripe beside a name. */
export function TeamMark({ color, name, className, children }: { color?: string | null; name?: string; className?: string; children?: ReactNode }) {
  const hex = normalizeHex(color) ?? '#7a7a84';
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <span
        aria-hidden
        className="h-[1.1em] w-1 shrink-0"
        style={{ backgroundColor: hex }}
      />
      {children ?? (name ? <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span> : null)}
    </span>
  );
}

export type TyreCompound = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet';

const TYRE: Record<TyreCompound, { letter: string; ring: string; name: string }> = {
  soft: { letter: 'S', ring: 'var(--color-tyre-soft)', name: 'Soft' },
  medium: { letter: 'M', ring: 'var(--color-tyre-medium)', name: 'Medium' },
  hard: { letter: 'H', ring: 'var(--color-tyre-hard)', name: 'Hard' },
  intermediate: { letter: 'I', ring: 'var(--color-tyre-inter)', name: 'Intermediate' },
  wet: { letter: 'W', ring: 'var(--color-tyre-wet)', name: 'Wet' },
};

/** Map an OpenF1 compound string ("SOFT", "INTERMEDIATE") to a compound, or null. */
export function toTyreCompound(value?: string | null): TyreCompound | null {
  const v = value?.trim().toLowerCase();
  if (!v) return null;
  if (v.startsWith('inter')) return 'intermediate';
  return (['soft', 'medium', 'hard', 'wet'] as const).find((c) => c === v) ?? null;
}

/** Pirelli-style compound mark: a coloured ring with its letter. */
export function TyreBadge({ compound, showName = false, className }: { compound: TyreCompound; showName?: boolean; className?: string }) {
  const t = TYRE[compound];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        role="img"
        aria-label={`${t.name} tyre`}
        className="inline-flex size-6 items-center justify-center rounded-full bg-ground-deep font-text text-[0.6875rem] font-[800] tracking-[0.02em] text-ink"
        style={{ boxShadow: `inset 0 0 0 2.5px ${t.ring}` }}
      >
        <span aria-hidden>{t.letter}</span>
      </span>
      {showName && <span className="font-text text-small text-fg-2">{t.name}</span>}
    </span>
  );
}

export type FlagKind = 'green' | 'yellow' | 'double-yellow' | 'red' | 'blue' | 'safety-car' | 'virtual-safety-car' | 'chequered';

const FLAG: Record<FlagKind, { label: string; swatch: string }> = {
  green: { label: 'Green flag', swatch: 'var(--color-flag-green)' },
  yellow: { label: 'Yellow flag', swatch: 'var(--color-flag-yellow)' },
  'double-yellow': { label: 'Double yellow', swatch: 'var(--color-flag-yellow)' },
  red: { label: 'Red flag', swatch: 'var(--color-flag-red)' },
  blue: { label: 'Blue flag', swatch: 'var(--color-flag-blue)' },
  'safety-car': { label: 'Safety car', swatch: 'var(--color-flag-sc)' },
  'virtual-safety-car': { label: 'Virtual safety car', swatch: 'var(--color-flag-sc)' },
  chequered: { label: 'Chequered flag', swatch: 'repeating-conic-gradient(#f4f4f5 0 25%, #0b0b0c 0 50%) 0 0 / 6px 6px' },
};

/** Race-control flag state with its name always visible. */
export function FlagBadge({ flag, className }: { flag: FlagKind; className?: string }) {
  const f = FLAG[flag];
  return (
    <span className={cn('inline-flex items-center gap-2 font-text text-small font-[650] text-fg', className)}>
      <span aria-hidden className="h-3 w-4.5 shrink-0" style={{ background: f.swatch }} />
      {f.label}
    </span>
  );
}

const SECTOR = {
  purple: { label: 'Fastest overall', cls: 'bg-sector-purple' },
  green: { label: 'Personal best', cls: 'bg-sector-green' },
  yellow: { label: 'No improvement', cls: 'bg-sector-yellow' },
} as const;

/** Timing-screen sector colour with its meaning available to assistive tech. */
export function SectorMark({ kind, className }: { kind: keyof typeof SECTOR; className?: string }) {
  return <span role="img" aria-label={SECTOR[kind].label} className={cn('inline-block h-1.5 w-6', SECTOR[kind].cls, className)} />;
}
