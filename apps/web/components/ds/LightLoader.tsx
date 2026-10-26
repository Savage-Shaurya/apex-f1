import { cn } from '@apex/ui';

/**
 * Loading state in the Carbon & Light voice: the real status message in
 * readable text, and under it one thin streak of light running along a
 * hairline track. CSS only (transform, no JS clock); under reduced motion
 * the streak rests still on the track. The message is the announcement
 * (role="status"); the track is decorative.
 */
export function LightLoader({ message = 'Loading', className }: { message?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex w-full max-w-[16rem] flex-col items-start gap-3', className)}>
      <span className="font-text text-small text-fg-2">{message}</span>
      <span aria-hidden className="ds-light-track">
        <span className="ds-light-streak" />
      </span>
    </div>
  );
}
