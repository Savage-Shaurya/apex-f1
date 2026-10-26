'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { canRunHeavyEffects } from './preferences';

function subscribeReduced(changed: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', changed);
  return () => mq.removeEventListener('change', changed);
}

/**
 * Probe once per page load. The probe context is released straight away
 * (WEBGL_lose_context), so the check never holds a GPU context of its own
 * next to the real scene (PERF2-6); browsers cap live contexts at ~16.
 */
function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

let webgl: boolean | null = null;
function heavyAllowed(): boolean {
  if (!canRunHeavyEffects()) return false;
  webgl ??= supportsWebGL();
  return webgl;
}

/**
 * Stage for a signature WebGL moment (e.g. the R3F circuit scene).
 *
 *  - The static `fallback` (an SVG or image of the same subject) is always in
 *    the layout and is what server HTML, reduced motion, Save-Data, low-memory
 *    devices and browsers without WebGL see.
 *  - The scene mounts only once the stage comes within `rootMargin` of the
 *    viewport (lazy: pass a next/dynamic component with ssr:false).
 *  - `active` is false whenever the stage is off-screen or the tab is hidden;
 *    scenes must stop drawing then (drive frames from useTicker(cb, active)).
 *    Keep the scene mounted while inactive (do not unmount the canvas).
 *  - The fallback stays visible until the scene calls `ready()`, so a scene
 *    that fails to start never leaves an empty box.
 */
export function LazyStage({
  fallback,
  children,
  rootMargin = '300px 0px',
  className,
  label,
}: {
  fallback: ReactNode;
  /** Render the scene. Call `ready()` once it has drawn its first frame; the fallback stays until then. */
  children: (state: { active: boolean; ready: () => void }) => ReactNode;
  rootMargin?: string;
  className?: string;
  /** Accessible description of what the stage shows (the fallback carries it when the scene is off). */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const allowed = useSyncExternalStore(subscribeReduced, heavyAllowed, () => false);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [drawn, setDrawn] = useState(false);

  const markDrawn = useCallback(() => setDrawn(true), []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !allowed) return;
    const nearObserver = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) setNear(true); }, { rootMargin });
    const visibleObserver = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.01 });
    nearObserver.observe(el);
    visibleObserver.observe(el);
    const onVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      nearObserver.disconnect();
      visibleObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [allowed, rootMargin]);

  const mounted = allowed && near;
  const showScene = mounted && drawn;
  return (
    <div ref={ref} className={cn('relative', className)} role={label ? 'img' : undefined} aria-label={label}>
      <div aria-hidden={showScene || undefined} className={cn('transition-opacity duration-[var(--duration-slow)]', showScene && 'opacity-0')}>
        {fallback}
      </div>
      {mounted && (
        <div aria-hidden className={cn('absolute inset-0 transition-opacity duration-[var(--duration-slow)]', showScene ? 'opacity-100' : 'opacity-0')}>
          {children({ active: visible && pageVisible, ready: markDrawn })}
        </div>
      )}
    </div>
  );
}
