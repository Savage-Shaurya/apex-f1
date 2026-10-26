import { gsap } from 'gsap';

/**
 * requestAnimationFrame on the site's single clock. React Bits' WebGL
 * backgrounds schedule one frame at a time with rAF; these drop-in
 * replacements schedule that frame on GSAP's ticker instead (the ticker that
 * also steps Lenis and ScrollTrigger), so every moving thing on the page
 * shares one heartbeat. A frame requested during a tick runs on the next
 * tick, never re-entrantly in the same one. `minGapMs` caps ambient effects
 * (30 fps light is indistinguishable from 60 and costs half the GPU).
 */
let seq = 0;
const pending = new Map<number, () => void>();

export function requestFrame(callback: (now: number) => void, minGapMs = 0): number {
  const id = ++seq;
  let requestedOn = -1;
  let armed = false;
  const requestedAt = performance.now();
  const run = () => {
    // A sleeping ticker can tick synchronously inside add(): never run before add() has returned.
    if (!armed || gsap.ticker.frame === requestedOn) return;
    // Optional frame cap (e.g. 30 fps for ambient light): wait on the same clock.
    if (minGapMs && performance.now() - requestedAt < minGapMs) return;
    gsap.ticker.remove(run);
    pending.delete(id);
    callback(performance.now());
  };
  pending.set(id, run);
  gsap.ticker.add(run);
  requestedOn = gsap.ticker.frame;
  armed = true;
  return id;
}

export function cancelFrame(id: number): void {
  const run = pending.get(id);
  if (!run) return;
  gsap.ticker.remove(run);
  pending.delete(id);
}
