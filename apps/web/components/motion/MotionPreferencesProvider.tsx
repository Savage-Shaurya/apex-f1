'use client';

import { LazyMotion, MotionConfig } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';

const loadFeatures = () => import('./motion-features').then((mod) => mod.default);

/**
 * Motion for the whole site. Components render the slim `m.*` elements; the
 * animation engine (framer-motion's domMax features) is fetched after first
 * paint, so the library no longer weighs on every page's first load.
 */
export function MotionPreferencesProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Media preferences remain reactive when the OS setting or input changes. */
export function useMotionPreferences() {
  const [preferences, setPreferences] = useState({ reducedMotion: false, coarsePointer: false });
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const update = () => setPreferences({ reducedMotion: reduced.matches, coarsePointer: coarse.matches });
    update();
    reduced.addEventListener('change', update);
    coarse.addEventListener('change', update);
    return () => { reduced.removeEventListener('change', update); coarse.removeEventListener('change', update); };
  }, []);
  return preferences;
}
