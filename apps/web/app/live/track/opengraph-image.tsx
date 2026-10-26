import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Fastest lap on track. The fastest lap of the latest finished session, traced around the circuit.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Timing", title: "Fastest lap on track", subtitle: "The fastest lap of the latest finished session, traced around the circuit." });
}
