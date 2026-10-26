'use client';

import { cn } from '@apex/ui';
import { useCountdown } from './use-countdown';
import { RollingNumber } from '@/components/motion/RollingNumber';

/**
 * Countdown to a real session start (ISO from Jolpica/OpenF1). Server HTML
 * renders dashes, so no clock value can mismatch on hydration. Digits roll
 * on the shared spring; labels are words, not single letters.
 */
export function CountdownClock({ targetIso, size = 'l', startedLabel = 'Session start time reached', className }: { targetIso: string; size?: 'm' | 'l' | 'xl'; startedLabel?: string; className?: string }) {
  const c = useCountdown(targetIso);
  if (!c.valid) return <span className="font-text text-small text-fg-3">Start time not published</span>;
  if (c.started) return <span className="font-text text-ui font-[650] text-fg">{startedLabel}</span>;
  const number = size === 'xl' ? 'text-stat-xl' : size === 'm' ? 'text-stat-m' : 'text-stat-l';
  // Days drop out on race week's last day rather than showing a zero.
  const parts: Array<[number | null, string, number]> = [
    ...(c.days === 0 ? [] : [[c.days, c.days === 1 ? 'day' : 'days', 1] as [number | null, string, number]]),
    [c.hours, 'hrs', 2],
    [c.minutes, 'min', 2],
    [c.seconds, 'sec', 2],
  ];
  return (
    <span role="timer" aria-live="off" className={cn('inline-flex items-end gap-[clamp(0.9rem,2.4vw,2rem)]', className)}>
      {parts.map(([value, unit, pad]) => (
        <span key={unit} className="flex flex-col items-start gap-1.5">
          <span className={cn('font-display font-normal-width leading-none text-fg tabular-nums', number)}>
            {value === null ? '-'.repeat(pad) : <RollingNumber value={value} pad={pad} />}
          </span>
          <span className="font-text text-label uppercase text-fg-3">{unit}</span>
        </span>
      ))}
    </span>
  );
}
