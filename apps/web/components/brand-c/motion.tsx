'use client';

import { useRef, type ReactNode } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { cn } from '@apex/ui';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll depth on the site's one clock: children marked `data-depth="n"`
 * drift by n x 6% of their height as the section scrolls out (transform
 * only, scrubbed by ScrollTrigger, which Lenis already drives). Nothing moves
 * under reduced motion. No pin, no scroll hijack.
 */
export function Depth({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    // Fine pointers only: phones and tablets scroll natively with no per-frame transform work.
    mm.add('(prefers-reduced-motion: no-preference) and (pointer: fine)', () => {
      root.current?.querySelectorAll<HTMLElement>('[data-depth]').forEach((el) => {
        const depth = Number(el.dataset.depth) || 0;
        gsap.to(el, {
          yPercent: depth * 6,
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
        });
      });
    });
    return () => mm.revert();
  }, { scope: root });
  return <Tag ref={root as never} className={cn('relative', className)}>{children}</Tag>;
}
