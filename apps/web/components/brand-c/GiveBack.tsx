import Link from 'next/link';
import { KindLight } from './stages';

/** The Give back band: humane, humble, never small. */
export function GiveBack() {
  return (
    <section aria-labelledby="bc-give-title" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-24 lg:py-32">
      <KindLight className="pointer-events-none absolute inset-0 -z-10 [&>div]:absolute [&>div]:inset-0" />
      <div className="ds-container relative text-center">
        <p className="bc-label text-[color:var(--bc-silver)]">Give back</p>
        <h2 id="bc-give-title" className="bc-serif mx-auto mt-6 max-w-[18ch] text-[clamp(2.4rem,6vw,5rem)] leading-[1.04] text-white">Every life deserves a pit crew.</h2>
        <p className="mx-auto mt-6 max-w-[52ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">
          Apex asks you for nothing. If it ever made a race weekend better, pass it on to someone who cannot ask: feed a stray, give a shelter an hour, bring one animal home.
        </p>
        <Link href="/support" className="mt-9 inline-flex min-h-12 items-center gap-2 rounded-full bg-[color:var(--bc-red)] px-7 text-[0.95rem] font-semibold text-white transition-colors hover:bg-[#ff1a12]">Help an animal today <span aria-hidden>→</span></Link>
      </div>
    </section>
  );
}
