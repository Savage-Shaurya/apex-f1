import { LightLoader } from '@/components/ds';
import '@/components/brand-c/brand-c.css';

/**
 * Loading state for the drivers routes in Carbon & Light: the night stage at
 * the hero's height, the thin light line with the real status message, and
 * a page-tall ground so the footer never shows above the fold and jumps away
 * when the page arrives (no layout shift).
 */
export function CarbonLoading({ message }: { message: string }) {
  return (
    <div aria-busy="true" className="bc relative min-h-[calc(100svh+40rem)]">
      <div className="relative isolate overflow-hidden border-b border-[color:var(--bc-rule)]">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
        <div className="ds-container flex min-h-[min(70svh,640px)] items-end pb-14 pt-16">
          <LightLoader message={message} />
        </div>
      </div>
    </div>
  );
}
