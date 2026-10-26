/**
 * Motion tokens for motion/react (framer-motion) and GSAP. One vocabulary,
 * one clock: GSAP's ticker drives ScrollTrigger over native scroll (ScrollProvider), and
 * anything that needs per-frame work subscribes to the same ticker (useTicker).
 */
import { duration, ease, gsapEase } from '@apex/ui/tokens';

export { duration, ease, gsapEase };

/** Seconds, for motion/react and GSAP. */
export const seconds = {
  instant: duration.instant / 1000,
  fast: duration.fast / 1000,
  base: duration.base / 1000,
  slow: duration.slow / 1000,
  cinematic: duration.cinematic / 1000,
} as const;

/** Spring presets (motion/react). */
export const spring = {
  /** Buttons, toggles, small state changes. */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.6 },
  /** Panels, menus, list reorder (timing tower FLIP). */
  settle: { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 },
  /** Rolling digits. */
  digit: { type: 'spring', stiffness: 280, damping: 24, mass: 0.35 },
} as const;

/** Standard transitions. */
export const transition = {
  enter: { duration: seconds.slow, ease: ease.out },
  exit: { duration: seconds.fast, ease: ease.exit },
  state: { duration: seconds.base, ease: ease.out },
  brake: { duration: seconds.cinematic, ease: ease.brake },
} as const;

/** Section entrances: heading, then text, then picture. */
export const reveal = {
  distance: 24,
  stagger: 0.075,
  start: 'top 88%',
} as const;
