import { cn } from '@apex/ui';

/**
 * The Apex wordmark: Anybody ExtraBold set extended, with the apex of the A
 * cut by the start-light red. Text, not an image, so it stays sharp and
 * readable at every size. Not an F1 mark and not derived from one.
 */
export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'xl' }) {
  if (size === 'xl') {
    // Full-width closing wordmark, drawn as a decorative graphic: textLength
    // makes the four letters span the frame exactly at every width, so it can
    // never overflow or clip. The readable name lives in the header.
    return (
      <svg viewBox="0 0 1000 232" className={cn('block h-auto w-full text-fg', className)} aria-hidden focusable="false">
        <text
          x="0"
          y="222"
          textLength="1000"
          lengthAdjust="spacingAndGlyphs"
          fill="currentColor"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 850, fontSize: 300, fontStretch: '130%' }}
        >
          APEX
        </text>
      </svg>
    );
  }
  const cls = size === 'sm' ? 'text-[1.125rem]' : 'text-[1.375rem]';
  return (
    <span className={cn('inline-flex items-start font-display font-[850] uppercase leading-none tracking-[0.01em] text-fg', cls, className)} style={{ fontStretch: '138%' }}>
      Apex
      <span aria-hidden className="ml-[0.08em] mt-[0.08em] inline-block size-[0.24em] bg-brand-red" />
    </span>
  );
}
