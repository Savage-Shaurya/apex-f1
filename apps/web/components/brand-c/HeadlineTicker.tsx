'use client';

import { useEffect, useRef, useState } from 'react';
import { Ago, type WireEntry } from './live';

/**
 * The newest Formula 1 headlines running along the foot of the hero, like a
 * broadcast ticker. Compositor-only marquee (CSS transform); it pauses on
 * hover, on keyboard focus, while off-screen and from its own button
 * (WCAG 2.2.2). Under reduced motion it is a still row you can scroll.
 * The second copy that makes the loop seamless is hidden from assistive tech
 * and taken out of the tab order. When a headline gets keyboard focus the row
 * stops, returns to a still, scrollable strip and the browser scrolls the
 * focused headline into view, so focus is never off-screen (WCAG 2.4.11).
 */
export function HeadlineTicker({ items }: { items: WireEntry[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // The browser leaves a partly visible link where it is, so a focused headline
  // is scrolled fully into the (now still) strip, clear of the soft edge.
  const reveal = (e: React.FocusEvent<HTMLDivElement>) => {
    const box = e.currentTarget;
    const link = e.target as HTMLElement;
    if (!link.matches(':focus-visible')) return;
    const r = link.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const pad = 48;
    if (r.left < b.left + pad) box.scrollLeft += r.left - b.left - pad;
    else if (r.right > b.right - pad) box.scrollLeft += Math.min(r.right - b.right + pad, r.left - b.left - pad);
  };
  if (!items.length) {
    return <div className="relative z-[5] border-t border-white/10 bg-[#070709]"><p className="ds-container py-3 text-[0.88rem] text-[color:var(--bc-silver)]">Headlines are unavailable right now.</p></div>;
  }
  // About 5 s per headline keeps every line readable at a glance.
  const seconds = Math.max(30, items.length * 7);
  const row = (clone: boolean) => (
    <ul className={clone ? 'bc-ticker-clone flex shrink-0' : 'flex shrink-0'} aria-hidden={clone || undefined} inert={clone || undefined}>
      {items.map((it) => (
        <li key={it.href} className="flex shrink-0 items-center">
          <a href={it.href} target="_blank" rel="noopener noreferrer" className="group flex min-h-11 items-center gap-3 px-6 text-[0.9rem]">
            <span className="font-medium text-[color:var(--bc-white)] group-hover:underline group-hover:decoration-[color:var(--bc-red)] group-hover:decoration-2 group-hover:underline-offset-4">{it.title}</span>
            <span className="whitespace-nowrap text-[0.8rem] text-[color:var(--bc-silver)]">{it.source} · <Ago ms={it.publishedMs} fallback={it.age} /></span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <span aria-hidden className="h-3 w-px bg-white/25" />
        </li>
      ))}
    </ul>
  );
  return (
    <div ref={root} className="bc-ticker relative z-[5] flex items-stretch border-t border-white/10 bg-[#070709]">
      <p className="bc-label relative z-[1] flex shrink-0 items-center gap-2 bg-[color:var(--bc-red)] px-4 text-[0.7rem] text-white sm:px-5">
        <span className="hidden sm:inline">Paddock</span> wire
      </p>
      {/* The pause control comes first in the tab order (WCAG 2.2.2); CSS order keeps it at the right edge. */}
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-pressed={paused}
        aria-label={paused ? 'Play headlines' : 'Pause headlines'}
        className="order-last grid w-12 shrink-0 place-items-center border-l border-white/10 text-[color:var(--bc-silver)] transition-colors hover:bg-white/5 hover:text-white active:scale-95"
      >
        {paused
          ? <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path fill="currentColor" d="M4 2.5v11l9-5.5z" /></svg>
          : <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden><path fill="currentColor" d="M4 2.5h3v11H4zM9 2.5h3v11H9z" /></svg>}
      </button>
      <div onFocus={reveal} className="bc-ticker-scroll relative min-w-0 flex-1 [mask-image:linear-gradient(90deg,transparent,#000_3%,#000_94%,transparent)]" aria-label="Latest Formula 1 headlines" role="region">
        <div className="bc-ticker-track" data-run="" data-paused={paused || !onScreen || undefined} style={{ '--ticker-s': `${seconds}s` } as React.CSSProperties}>
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
