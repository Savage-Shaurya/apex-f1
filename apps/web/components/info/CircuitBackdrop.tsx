import { cn } from '@apex/ui';
import { CircuitStreak } from '@/components/brand-c/CircuitStreak';
import { circuitPath, getCircuit } from '@/lib/circuits';

/**
 * A real circuit outline in an info page's opening (VI-04): the
 * bacinger/f1-circuits geometry lapped by the comet, placed by each page in
 * an empty part of its layout (never behind text), with the circuit's name
 * under it. Restrained by design: decoration only (hidden from assistive
 * tech), a soft pool of light under it, still under reduced motion. Null for
 * an unknown circuit id.
 */
export function CircuitBackdrop({ circuitId, className }: { circuitId: string; className?: string }) {
  const c = getCircuit(circuitId);
  if (!c) return null;
  return (
    <figure aria-hidden data-circuit-backdrop={circuitId} className={cn('pointer-events-none relative m-0 select-none', className)}>
      <div aria-hidden className="absolute inset-[8%] -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(225_6_0/0.10),transparent)]" />
      <div className="aspect-[4/3] w-full">
        <CircuitStreak d={circuitPath(c)} width={c.width} height={c.height} label="" />
      </div>
      <figcaption className="bc-label mt-1 text-right text-[0.62rem] text-[color:var(--bc-titanium)]">{c.name}</figcaption>
    </figure>
  );
}
