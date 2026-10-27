'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** Lenis smoothing, in its own chunk: fetched only when SMOOTH_QUERY matches (never on phones). */
const SmoothScroll = dynamic(() => import('./SmoothScroll'), { ssr: false });

/**
 * One scroll clock for the whole site: GSAP's ticker.
 *
 * Desktop wheels and trackpads (fine pointer + hover, motion allowed) get
 * Lenis smoothing, stepped by GSAP's ticker (never its own rAF), with
 * ScrollTrigger updated from Lenis' scroll event. Everything else (touch,
 * pens, reduced motion) keeps the browser's own scrolling: `syncTouch` is
 * off, and Lenis is not even mounted under reduced motion or on touch-first
 * screens, so phones pay nothing for it.
 *
 * Lessons from the 2026-10-26 motion audit, built in:
 *  - No wheel dead zones. Nothing on the site uses `data-lenis-prevent*`
 *    on a rail: a vertical wheel over a horizontal rail scrolls the page.
 *    Horizontal gestures (trackpad swipes, shift+wheel) are handed straight
 *    back to the browser, so rails still swipe natively.
 *  - Nested vertical scrollers (menus, dialogs, long lists) scroll natively
 *    (`allowNestedScroll`), and modal dialogs are never smoothed.
 *  - Lenis pauses on its own when the document is scroll-locked
 *    (`autoToggle`, e.g. the mobile menu sets overflow: hidden on <html>).
 *
 * Scroll scenes (ScrollTrigger) are re-measured whenever the document height
 * settles (streamed sections, late images and fonts) and on every route.
 */
const SMOOTH_QUERY = '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)';
const subscribeSmooth = (changed: () => void) => {
  const mq = window.matchMedia(SMOOTH_QUERY);
  mq.addEventListener('change', changed);
  return () => mq.removeEventListener('change', changed);
};

export function ScrollProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    // Streamed sections, late images and fonts change the document height
    // after scenes were measured; re-measure (debounced) whenever it does.
    let lastHeight = document.documentElement.scrollHeight;
    let refreshTimer = 0;
    const heightWatch = new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (Math.abs(h - lastHeight) < 2) return;
      lastHeight = h;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 180);
    });
    heightWatch.observe(document.body);
    return () => {
      heightWatch.disconnect();
      window.clearTimeout(refreshTimer);
    };
  }, []);

  // New route: re-measure every scroll scene against the new document. The
  // App Router itself scrolls to the top (or to the hash target).
  useEffect(() => {
    const hash = window.location.hash;
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    if (!hash) return () => window.clearTimeout(id);

    // Anchor targets (/schedule#next): content above them settles after the
    // first paint (streamed sections, late images), which can leave the
    // target under the fixed header. Re-align to the target's own
    // scroll-margin while the page settles, until the reader scrolls.
    let target: HTMLElement | null = null;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { target = null; }
    if (!target) return () => window.clearTimeout(id);
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const align = () => {
      if (cancelled || !target?.isConnected) return;
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const top = target.getBoundingClientRect().top;
      if (Math.abs(top - margin) < 2) return;
      window.scrollTo({ top: window.scrollY + top - margin, behavior: 'instant' });
    };
    const timers = [160, 450, 900, 1600, 2600].map((ms) => window.setTimeout(align, ms));
    // Late layout shifts (a slow image or stream) re-align too, for the first few seconds.
    const shifts = new ResizeObserver(() => window.requestAnimationFrame(align));
    shifts.observe(document.body);
    timers.push(window.setTimeout(() => shifts.disconnect(), 4000));
    const opts = { passive: true, once: true } as const;
    window.addEventListener('wheel', cancel, opts);
    window.addEventListener('touchstart', cancel, opts);
    window.addEventListener('keydown', cancel, { once: true });
    window.addEventListener('pointerdown', cancel, opts);
    return () => {
      window.clearTimeout(id);
      timers.forEach((t) => window.clearTimeout(t));
      shifts.disconnect();
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
      window.removeEventListener('pointerdown', cancel);
    };
  }, [pathname]);

  const smooth = useSyncExternalStore(subscribeSmooth, () => window.matchMedia(SMOOTH_QUERY).matches, () => false);
  // A sibling, so turning smoothing on or off never remounts the page.
  return <>{smooth ? <SmoothScroll /> : null}{children}</>;
}
