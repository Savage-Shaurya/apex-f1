'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { preciseSessionTimestamp } from '@/lib/session-calendar';

function pad(n: number | null, len = 2) {
  return n === null ? '--' : String(n).padStart(len, '0');
}

/** Ticking race countdown. SSR renders `--` so no clock value can mismatch. */
export function useCountdown(targetIso: string) {
  const target = preciseSessionTimestamp(targetIso) ?? Number.NaN;
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!Number.isFinite(target) || Date.now() >= target) return () => {};
      const id = window.setInterval(changed, 1000);
      return () => window.clearInterval(id);
    },
    [target],
  );
  const snapshot = useCallback(() => (Number.isFinite(target) ? Math.floor(Date.now() / 1000) * 1000 : null), [target]);
  const now = useSyncExternalStore(subscribe, snapshot, () => null);
  const delta = now === null ? null : Math.max(0, target - now);
  return {
    valid: Number.isFinite(target),
    started: delta === 0,
    days: delta === null ? null : Math.floor(delta / 86_400_000),
    hours: delta === null ? null : Math.floor((delta % 86_400_000) / 3_600_000),
    minutes: delta === null ? null : Math.floor((delta % 3_600_000) / 60_000),
    seconds: delta === null ? null : Math.floor((delta % 60_000) / 1000),
  };
}

export function Countdown({
  targetIso,
  size = 'md',
  className,
}: {
  targetIso: string;
  size?: 'sm' | 'md' | 'xl';
  className?: string;
}) {
  const c = useCountdown(targetIso);
  if (!c.valid) return <span className="text-sm text-on-surface-variant">Start time unavailable</span>;
  if (c.started) return <span className="font-data text-xs uppercase tracking-[0.16em] text-telemetry-red">Scheduled start reached</span>;

  const num =
    size === 'xl'
      ? 'font-display text-[clamp(2.5rem,6vw,5.5rem)] font-extrabold leading-none tracking-[-0.03em]'
      : size === 'md'
        ? 'font-data text-2xl font-medium'
        : 'font-data text-[13px] font-medium';
  const unit = size === 'xl' ? 'font-data text-[11px] tracking-[0.2em] text-on-surface-variant' : 'font-data text-[9px] tracking-[0.18em] text-on-surface-variant';
  const segs: Array<[string, string]> = [
    [pad(c.days, 1), 'D'],
    [pad(c.hours), 'H'],
    [pad(c.minutes), 'M'],
    [pad(c.seconds), 'S'],
  ];
  return (
    <span role="timer" aria-live="off" className={`inline-flex items-baseline ${size === 'xl' ? 'gap-5 md:gap-8' : 'gap-2'} ${className ?? ''}`}>
      {segs.map(([v, u]) => (
        <span key={u} className="inline-flex items-baseline gap-1">
          <span className={`tabular text-on-background ${num}`}>{v}</span>
          <span className={unit}>{u}</span>
        </span>
      ))}
    </span>
  );
}
