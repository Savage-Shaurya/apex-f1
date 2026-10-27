'use client';

import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ReactLenis, useLenis } from 'lenis/react';

gsap.registerPlugin(ScrollTrigger);

/**
 * Desktop smoothing for the root scroller (see ScrollProvider for the rules).
 * Its own module so Lenis is a separate chunk: ScrollProvider loads it only
 * where smoothing runs (fine pointer + hover, motion allowed), so phones and
 * reduced-motion visitors never download it (home performance, 2026-10-27).
 */
/** Never smooth inside a modal dialog: it owns its own scroll. */
const preventSmooth = (node: HTMLElement) => node.localName === 'dialog' || node.getAttribute('aria-modal') === 'true';

/** Lenis smoothing on the root scroller, stepped by GSAP's ticker. Renders nothing itself. */
export default function SmoothScroll() {
  const lenis = useLenis();
  useEffect(() => {
    if (!lenis) return;
    const step = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(step);
    // Lenis already eases; GSAP's lag smoothing would make the page lurch after a busy frame.
    gsap.ticker.lagSmoothing(0);
    const update = () => ScrollTrigger.update();
    lenis.on('scroll', update);
    return () => {
      gsap.ticker.remove(step);
      lenis.off('scroll', update);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [lenis]);
  return (
    <ReactLenis
      root
      options={{
        autoRaf: false,
        // Time-based damping (lambda = lerp x 60 per second): 0.2 covers 90% of a wheel step in ~190 ms.
        lerp: 0.2,
        wheelMultiplier: 1,
        smoothWheel: true,
        syncTouch: false,
        allowNestedScroll: true,
        autoToggle: true,
        anchors: true,
        stopInertiaOnNavigate: true,
        prevent: preventSmooth,
        // Horizontal gestures belong to the rail under the pointer, natively.
        virtualScroll: ({ deltaX, deltaY }) => Math.abs(deltaY) >= Math.abs(deltaX),
      }}
    />
  );
}

