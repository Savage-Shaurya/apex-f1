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
 * tabs, drawn at the screen density (up to 2x, within a pixel budget: rb/pixel-ratio), never on lite devices (touch, <=4 cores, <=4 GB), and the CSS floodlight stays for reduced motion,
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
            maxDevicePixelRatio={2}
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
  // VI-03: the still light is a real fan of rays, not a faint glow, so phones see the same light.
  const still = <div className="bc-kind-still absolute inset-0" />;
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
