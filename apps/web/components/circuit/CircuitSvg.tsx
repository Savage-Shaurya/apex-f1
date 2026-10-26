import { circuitPath, getCircuit } from '@/lib/circuits';

/**
 * Static circuit outline from real geometry. Renders nothing when the
 * circuit is unknown, never a generic stand-in shape.
 */
export function CircuitSvg({
  circuitId,
  className,
  stroke = 'currentColor',
  strokeWidth = 2,
  title,
  startMarker = true,
  draw = false,
}: {
  circuitId?: string | null;
  className?: string;
  stroke?: string;
  strokeWidth?: number;
  title?: string;
  startMarker?: boolean;
  /** Stroke draws itself on first paint (CSS only). */
  draw?: boolean;
}) {
  const c = getCircuit(circuitId);
  if (!c) return null;
  // Stroke width is in screen px (non-scaling); padding/marker are in path units.
  const pad = 36;
  const d = circuitPath(c);
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${c.width + pad * 2} ${c.height + pad * 2}`}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      <path
        d={d}
        stroke={stroke}
        // Dash-based drawing needs path units; static outlines keep a
        // constant screen-pixel stroke at any size.
        strokeWidth={draw ? strokeWidth * 6 : strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect={draw ? undefined : 'non-scaling-stroke'}
        pathLength={draw ? 1 : undefined}
        style={draw ? { strokeDasharray: 1, strokeDashoffset: 1, animation: 'apex-circuit-draw 2.2s cubic-bezier(0.16,1,0.3,1) 0.2s forwards' } : undefined}
      />
      {startMarker && <circle cx={c.points[0]} cy={c.points[1]} r={22} fill="var(--color-telemetry-red)" />}
    </svg>
  );
}
