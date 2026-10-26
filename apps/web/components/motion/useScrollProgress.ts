'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll progress (0..1) of the whole document, or of `target` through the
 * viewport, read from ScrollTrigger (the single clock). The callback fires on
 * scroll, not every frame, and is not a React state update: callers decide
 * when a change is worth a render (e.g. only when a light switches).
 */
export function useScrollProgress(onProgress: (progress: number) => void, target?: RefObject<HTMLElement | null>) {
  const saved = useRef(onProgress);
  useEffect(() => { saved.current = onProgress; }, [onProgress]);

  useEffect(() => {
    const element = target?.current ?? null;
    const trigger = ScrollTrigger.create(
      element
        ? { trigger: element, start: 'top bottom', end: 'bottom top', onUpdate: (self) => saved.current(self.progress), onRefresh: (self) => saved.current(self.progress) }
        : { start: 0, end: 'max', onUpdate: (self) => saved.current(self.progress), onRefresh: (self) => saved.current(self.progress) },
    );
    saved.current(trigger.progress);
    return () => trigger.kill();
  }, [target]);
}
