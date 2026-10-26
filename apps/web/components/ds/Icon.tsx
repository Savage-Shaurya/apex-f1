import type { SVGProps } from 'react';

/**
 * Inline SVG icons for the new UI. Arrows are drawn, not typed: the brand
 * faces do not carry every arrow glyph, and a fallback font would break the
 * set. 24px grid, 1.75 stroke, currentColor, decorative unless labelled.
 */
const PATHS = {
  'arrow-right': 'M4 12h15M13 6l6 6-6 6',
  'arrow-left': 'M20 12H5M11 6l-6 6 6 6',
  'arrow-up-right': 'M7 17 17 7M8 7h9v9',
  'arrow-down': 'M12 4v15M6 13l6 6 6-6',
  'chevron-right': 'm9 5 7 7-7 7',
  'chevron-left': 'm15 5-7 7 7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  'chevron-up': 'm5 15 7-7 7 7',
  search: 'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM16 16l5 5',
  menu: 'M3 7h18M3 17h18',
  close: 'M5 5l14 14M19 5 5 19',
  play: 'M7 4.5v15l12.5-7.5L7 4.5Z',
  pause: 'M7 4.5v15M17 4.5v15',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm4.5 12.5 5 5 10-11',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 11v6M12 7.5V8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  calendar: 'M4 9h16M8 3v4M16 3v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  'map-pin': 'M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12ZM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  timer: 'M12 9v4l2.5 1.5M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z',
  video: 'M3 6h13v12H3zM16 10l5-3v10l-5-3',
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = 20,
  label,
  strokeWidth = 1.75,
  className,
  ...rest
}: { name: IconName; size?: number; label?: string; strokeWidth?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const filled = name === 'play';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
