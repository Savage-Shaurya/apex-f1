'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { LazyStage } from '@/components/motion/LazyStage';
import { cancelFrame, requestFrame } from './rb/frame';
import { useLiteDevice } from './device';

const LightRays = dynamic(() => import('./rb/LightRays'), { ssr: false });

/** Tell the stage the scene is up after two ticks of the shared clock (its first frames are drawn by then). */
function ReadyAfterFrames({ ready }: { ready: () => void }) {
  useEffect(() => {
    let id = requestFrame(() => { id = requestFrame(() => ready()); });
    return () => cancelFrame(id);
  }, [ready]);
  return null;
}

/**
 * Floodlights over the grid: React Bits LightRays from above, cool white,
 * slow, 30 fps. Lazy (mounts near the viewport), paused off-screen and in hidden
 * tabs, DPR capped at 1.25, never on lite devices (touch, <=4 cores, <=4 GB), and the CSS floodlight stays for reduced motion,
 * Save-Data and no-WebGL browsers.
 */
export function Floodlights({ className }: { className?: string }) {
  const lite = useLiteDevice();
  if (lite) return <div className={className}><div className="bc-flood-static absolute inset-0" /></div>;
  return (
    <LazyStage className={className} rootMargin="200px 0px" fallback={<div className="bc-flood-static absolute inset-0" />}>
      {({ ready }) => (
        <>
          <div className="bc-flood-static absolute inset-0 opacity-60" />
          <LightRays
            raysOrigin="top-center"
            raysColor="#e9f0ff"
            raysSpeed={0.55}
            lightSpread={0.42}
            rayLength={1.55}
            rayDensity={0.9}
            raySharpness={0.42}
            glow={0.5}
            haze={0.45}
            atmosphere={0.35}
            saturation={0.6}
            intensity={0.82}
            fadeDistance={1.1}
            followMouse={false}
            cursorShadow={false}
            clickPulse={false}
            maxDevicePixelRatio={1.25}
            maxFps={30}
            className="absolute inset-0"
          />
          <ReadyAfterFrames ready={ready} />
        </>
      )}
    </LazyStage>
  );
}

/**
 * Give back: the same light, turned around. LightRays rise from below in a
 * warm, low-saturation red, slow as breathing: light offered upward rather
 * than floodlight poured down. (React Bits LightPillar was tried here and
 * dropped: its float render targets lost the WebGL context in testing.)
 */
export function KindLight({ className }: { className?: string }) {
  const lite = useLiteDevice();
  const still = <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_70%_at_50%_105%,rgb(255_120_100/0.20),rgb(225_6_0/0.08)_45%,transparent_75%)]" />;
  if (lite) return <div className={className}>{still}</div>;
  return (
    <LazyStage
      className={className}
      fallback={still}
    >
      {({ ready }) => (
        <>
          <LightRays
            raysOrigin="bottom-center"
            raysColor="#ff8f7a"
            raysSpeed={0.35}
            lightSpread={0.55}
            rayLength={1.3}
            rayDensity={0.7}
            raySharpness={0.3}
            glow={0.7}
            haze={0.5}
            atmosphere={0}
            saturation={0.8}
            intensity={0.7}
            followMouse={false}
            cursorShadow={false}
            clickPulse={false}
            maxDevicePixelRatio={1}
            maxFps={30}
            className="absolute inset-0"
          />
          <ReadyAfterFrames ready={ready} />
        </>
      )}
    </LazyStage>
  );
}
