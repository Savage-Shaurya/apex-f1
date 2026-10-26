'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@apex/ui';

/**
 * Jump to an era: one link per decade (focus ring drawn inside each link, so the scrolling rail never clips it), held under the header while the
 * season list scrolls, the decade in view marked. A plain list of anchor
 * links, so it works without script; script only marks the current decade
 * and keeps it in view inside the rail on phones.
 */
export function DecadeRail({ decades }: { decades: number[] }) {
  const [active, setActive] = useState<number | null>(decades[0] ?? null);
  const rail = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // The decade whose section crosses 35% of the viewport height; above the list, the newest.
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = window.innerHeight * 0.35;
      let current = decades[0] ?? null;
      for (const dec of decades) {
        const el = document.getElementById(`d${dec}`);
        if (el && el.getBoundingClientRect().top <= line) current = dec;
      }
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [decades]);
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const r = rail.current;
    if (!el || !r || r.scrollWidth <= r.clientWidth) return;
    r.scrollLeft = el.offsetLeft - (r.clientWidth - el.offsetWidth) / 2;
  }, [active]);
  return (
    <nav aria-label="Jump to a decade" className="sticky top-[var(--nav-offset)] z-20 border-y border-[color:var(--bc-rule)] bg-[color:rgb(5_5_6/0.96)] transition-[top] duration-300">
      <ul ref={rail} className="ds-container flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {decades.map((d) => (
          <li key={d} className="shrink-0">
            <a
              href={`#d${d}`}
              aria-current={active === d ? 'location' : undefined}
              className={cn('bc-mono relative inline-flex min-h-12 items-center px-3 text-[0.92rem] transition-colors focus-visible:outline-offset-[-4px]!', active === d ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-[2px] after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-titanium)] hover:text-white')}
            >
              {d}s
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
