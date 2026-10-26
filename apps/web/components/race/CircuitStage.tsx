'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CircuitStreak } from '@/components/brand-c/CircuitStreak';
import { useLiteDevice } from '@/components/brand-c/device';
import type { SceneProgress } from '@/components/circuit/CircuitScene';
import { LazyStage } from '@/components/motion/LazyStage';

gsap.registerPlugin(ScrollTrigger);

/** The scene reads this shared box on GSAP's ticker; ScrollTrigger writes it (no React render per scroll frame). */
function advance(box: SceneProgress, value: number) { box.current = value; }

const CircuitScene = dynamic(() => import('@/components/circuit/CircuitScene'), { ssr: false });

/**
 * The circuit, lit. On capable desktops the real outline becomes a 3D ribbon
 * whose red racing line is drawn as the section scrolls in, then a light laps
 * it (the R3F scene, lazy, on GSAP's ticker, paused off-screen). Touch
 * devices, small screens, reduced motion and no-WebGL browsers get the 2D
 * outline lapped by a streak of light (SVG), which is also what server HTML
 * shows. The hero's floodlights are off-screen by the time this is in view,
 * so at most one WebGL canvas is live.
 */
export function CircuitStage({ circuitId, d, width, height, label }: { circuitId: string; d: string; width: number; height: number; label: string }) {
  const lite = useLiteDevice();
  const host = useRef<HTMLDivElement>(null);
  const [progress] = useState<SceneProgress>(() => ({ current: 0 }));
  const invalidate = useRef<() => void>(() => {});

  useEffect(() => {
    if (lite || !host.current) return;
    const st = ScrollTrigger.create({
      trigger: host.current,
      start: 'top 85%',
      end: 'center 45%',
      scrub: true,
      onUpdate: (self) => { advance(progress, self.progress); invalidate.current(); },
    });
    advance(progress, st.progress);
    return () => st.kill();
  }, [lite, progress]);

  const flat = <div className="aspect-[4/3] w-full p-[4%]"><CircuitStreak d={d} width={width} height={height} label={label} /></div>;
  if (lite) return flat;
  return (
    <div ref={host}>
      <LazyStage fallback={flat} className="w-full" label={label}>
        {({ ready }) => (
          <CircuitScene
            circuitId={circuitId}
            progress={progress}
            className="absolute inset-0"
            onReady={(inv) => { invalidate.current = inv; inv(); ready(); }}
          />
        )}
      </LazyStage>
    </div>
  );
}
