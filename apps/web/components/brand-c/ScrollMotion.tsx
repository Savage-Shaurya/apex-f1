'use client';

import { useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const useIso = typeof window === 'undefined' ? () => {} : useLayoutEffect;

/**
 * Every scroll-driven move on the home page, set up once on the one clock
 * (GSAP's ticker; Lenis steps it on desktop):
 *
 *   [data-rv]          reveal: rises 24px into place, staggered per batch. Only
 *                      elements still wholly below the fold when the page
 *                      hydrates are ever hidden, and only from then on, so
 *                      nothing the first paint shows waits for script (F-06).
 *                      They start while still below the fold (top at 112% of
 *                      the viewport), so nothing is seen arriving late.
 *   [data-px="n"]      parallax: drifts n% of its height across its section.
 *   [data-zoom]        a picture settles from 1.1x to 1x as it crosses.
 *   [data-count="n"]   a real figure rolls up from zero the first time it is
 *                      seen (decimals from data-dec). The real value never
 *                      leaves the DOM: the rolling digits are an aria-hidden
 *                      overlay (rollingFigure), so screen readers, find-in-page
 *                      and translation always read the true number (F-10).
 *
 * Reduced motion: nothing moves; everything is simply there. Parallax and
 * zoom are for fine pointers only, so phones do no per-frame scroll work.
 */
/**
 * Draw a rolling figure over a real one without touching it. The element keeps
 * its server text (now transparent, still selectable and searchable) and an
 * aria-hidden overlay in the element's own colour shows the digits rolling.
 * The overlay sits on the final value's box, so the layout never moves.
 */
export function rollingFigure(el: HTMLElement, initial: string) {
  const ghost = document.createElement('span');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.className = 'bc-roll';
  ghost.style.color = getComputedStyle(el).color;
  ghost.textContent = initial;
  el.classList.add('bc-rolling');
  el.append(ghost);
  let done = false;
  return {
    show: (text: string) => { if (!done) ghost.textContent = text; },
    restore: () => {
      if (done) return;
      done = true;
      ghost.remove();
      el.classList.remove('bc-rolling');
    },
  };
}

export function ScrollMotion() {
  useIso(() => {
    const root = document.documentElement;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const vh = window.innerHeight;
      // Wholly below the fold now: nobody has seen these yet, so they can wait for their reveal.
      const later = gsap.utils.toArray<HTMLElement>('.bc [data-rv]').filter((el) => el.getBoundingClientRect().top >= vh);
      gsap.set(later, { opacity: 0, y: 24 });
      ScrollTrigger.batch(later, {
        start: 'top 112%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out', stagger: 0.07, overwrite: true }),
      });

      const restores: Array<() => void> = [];
      gsap.utils.toArray<HTMLElement>('.bc [data-count]').forEach((el) => {
        // A bare data-count is a styling hook (filter counts), not a figure to roll.
        if (!el.dataset.count || el.classList.contains('bc-rolling')) return;
        const value = Number(el.dataset.count);
        if (!Number.isFinite(value)) return;
        if (el.getBoundingClientRect().top < vh) return;
        const dec = Number(el.dataset.dec ?? 0);
        const fmt = new Intl.NumberFormat('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec });
        const box = { v: 0 };
        const figure = rollingFigure(el, fmt.format(0));
        restores.push(figure.restore);
        gsap.to(box, {
          v: value,
          duration: 1.4,
          ease: 'power2.out',
          onUpdate: () => figure.show(fmt.format(box.v)),
          onComplete: figure.restore,
          scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        });
      });
      return () => { for (const restore of restores) restore(); };
    });
    mm.add('(prefers-reduced-motion: no-preference) and (pointer: fine)', () => {
      gsap.utils.toArray<HTMLElement>('.bc [data-px]').forEach((el) => {
        const n = Number(el.dataset.px) || 0;
        gsap.fromTo(el, { yPercent: -n }, { yPercent: n, ease: 'none', scrollTrigger: { trigger: el.closest('section') ?? el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
      gsap.utils.toArray<HTMLElement>('.bc [data-zoom]').forEach((el) => {
        gsap.fromTo(el, { scale: 1.1 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom 40%', scrub: true } });
      });
    });
    // Marks the choreography as set up (tests and the gate wait for it). It hides nothing by itself.
    root.classList.add('bc-ready');
    return () => { mm.revert(); root.classList.remove('bc-ready'); };
  }, []);
  return null;
}
