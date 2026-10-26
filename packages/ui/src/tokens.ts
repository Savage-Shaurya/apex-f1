/**
 * Apex design tokens for JavaScript consumers (charts, canvas, WebGL, email).
 *
 * Direction: "Programme & Timing Sheet" (live reference: the dev-only /design route).
 * The canonical CSS is apps/web/app/globals.css (Tailwind 4 @theme); a test
 * (apps/web/components/ds/ds.test.ts) fails if a colour here drifts
 * from the value declared there.
 *
 * Black, white and red are the foundation. Red is the start light: it marks
 * what is live, next, selected or the one action. Everything else is carbon,
 * chalk and paper; team, sector, tyre and flag colours are data only.
 */

export const colors = {
  /* Carbon: the programme's ground and its tone steps (no lines needed). */
  groundDeep: '#050506',
  ground: '#0b0b0c',
  surface1: '#111113',
  surface2: '#17171a',
  surface3: '#1f1f23',
  surface4: '#2a2a2f',

  /* Ink on carbon. ink3 is the lowest value allowed for text (AA on surface4). */
  ink: '#f4f4f5',
  ink2: '#c3c3cb',
  ink3: '#9e9ea8',
  /** Non-text only (disabled glyph strokes, chart grid). Fails AA as text. */
  inkFaint: '#7a7a84',

  /* Paper: the timing sheet's ground and its ink. */
  paper: '#f3f2ee',
  paper2: '#e7e5df',
  paper3: '#d9d6ce',
  paperInk: '#0b0b0c',
  paperInk2: '#3f3f46',
  paperInk3: '#5c5c64',

  /* Red. Surface red carries white text (4.97:1); text red is a separate token. */
  brandRed: '#e10600',
  brandRedHover: '#c80500',
  brandRedPress: '#b80500',
  /** Readable red text on carbon (>= 4.35:1 on surface4, >= 5:1 on surface3 and below). */
  redInk: '#ff4d42',
  /** Readable red text on paper (>= 4.9:1 on paper3). */
  redInkPaper: '#b30500',

  /* F1 data semantics (timing screen conventions). On-carbon values; paper variants follow. */
  sectorPurple: '#c084fc',
  sectorPurplePaper: '#7e22ce',
  sectorGreen: '#34d17a',
  sectorGreenPaper: '#0e6b35',
  sectorYellow: '#ffd60a',

  tyreSoft: '#ff3b30',
  tyreMedium: '#ffd60a',
  tyreHard: '#f4f4f5',
  tyreInter: '#34c759',
  tyreWet: '#3b82f6',

  flagGreen: '#1fbf55',
  flagYellow: '#ffd60a',
  flagRed: '#e10600',
  flagBlue: '#3b82f6',
  flagSafetyCar: '#ffb020',

  positive: '#34d17a',
  negative: '#ff4d42',
  caution: '#ffb020',
  info: '#5b9dff',

  podiumGold: '#d4af37',
  podiumSilver: '#c0c4cc',
  podiumBronze: '#c58a54',
} as const;

export type ApexColorKey = keyof typeof colors;

/** CSS custom property each JS colour maps to in globals.css. */
export const colorCssVar: Record<ApexColorKey, string> = {
  groundDeep: '--color-ground-deep',
  ground: '--color-ground',
  surface1: '--color-surface-1',
  surface2: '--color-surface-2',
  surface3: '--color-surface-3',
  surface4: '--color-surface-4',
  ink: '--color-ink',
  ink2: '--color-ink-2',
  ink3: '--color-ink-3',
  inkFaint: '--color-ink-faint',
  paper: '--color-paper',
  paper2: '--color-paper-2',
  paper3: '--color-paper-3',
  paperInk: '--color-paper-ink',
  paperInk2: '--color-paper-ink-2',
  paperInk3: '--color-paper-ink-3',
  brandRed: '--color-brand-red',
  brandRedHover: '--color-brand-red-hover',
  brandRedPress: '--color-brand-red-press',
  redInk: '--color-red-ink',
  redInkPaper: '--color-red-ink-paper',
  sectorPurple: '--color-sector-purple',
  sectorPurplePaper: '--color-sector-purple-paper',
  sectorGreen: '--color-sector-green',
  sectorGreenPaper: '--color-sector-green-paper',
  sectorYellow: '--color-sector-yellow',
  tyreSoft: '--color-tyre-soft',
  tyreMedium: '--color-tyre-medium',
  tyreHard: '--color-tyre-hard',
  tyreInter: '--color-tyre-inter',
  tyreWet: '--color-tyre-wet',
  flagGreen: '--color-flag-green',
  flagYellow: '--color-flag-yellow',
  flagRed: '--color-flag-red',
  flagBlue: '--color-flag-blue',
  flagSafetyCar: '--color-flag-sc',
  positive: '--color-positive',
  negative: '--color-negative',
  caution: '--color-caution',
  info: '--color-info',
  podiumGold: '--color-podium-gold',
  podiumSilver: '--color-podium-silver',
  podiumBronze: '--color-podium-bronze',
};

export const fonts = {
  display: 'Anybody',
  text: 'Hanken Grotesk',
  editorial: 'EB Garamond',
  timing: 'JetBrains Mono',
} as const;

/**
 * Letter-spacing rules (em). The user asked for comfortable tracking:
 * nothing under 24px is ever tracked negative, uppercase labels open up,
 * display tightens only as it grows.
 */
export const tracking = {
  text: '0.01em',
  small: '0.016em',
  caption: '0.02em',
  ui: '0.012em',
  label: '0.1em',
  labelLarge: '0.08em',
  heading: '0em',
  headingLarge: '-0.006em',
  displayM: '-0.012em',
  displayL: '-0.018em',
  displayXl: '-0.022em',
  timing: '0.02em',
} as const;

export const space = {
  pageMarginPhone: '16px',
  pageMarginTablet: '24px',
  pageMarginDesktop: 'clamp(32px, 3.2vw, 56px)',
  containerMax: '1680px',
  measure: '68ch',
} as const;

export const radius = {
  none: '0px',
  xs: '2px',
  full: '9999px',
  chamferS: '8px',
  chamferM: '14px',
  chamferL: '24px',
} as const;

/** Durations in ms and seconds (GSAP takes seconds). */
export const duration = {
  instant: 100,
  fast: 160,
  base: 240,
  slow: 420,
  cinematic: 800,
} as const;

/** Cubic-bezier control points, shared by CSS (var(--ease-*)), motion/react and GSAP (CustomEase-free equivalents). */
export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.76, 0, 0.24, 1] as const,
  brake: [0.2, 0.9, 0.1, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
};

/** GSAP ease strings that match the curves above closely. */
export const gsapEase = {
  out: 'expo.out',
  inOut: 'power4.inOut',
  brake: 'power3.out',
  exit: 'power2.in',
} as const;

export const motion = {
  easeOut: `cubic-bezier(${ease.out.join(', ')})`,
  easeInOut: `cubic-bezier(${ease.inOut.join(', ')})`,
  easeBrake: `cubic-bezier(${ease.brake.join(', ')})`,
  durationFast: `${duration.fast}ms`,
  durationBase: `${duration.base}ms`,
  durationSlow: `${duration.slow}ms`,
  durationCinematic: `${duration.cinematic}ms`,
} as const;
