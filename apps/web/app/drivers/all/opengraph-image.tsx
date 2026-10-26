import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Every driver since 1950. Every driver in the World Championship record, each with a race-by-race career.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Drivers", title: "Every driver since 1950", subtitle: "Every driver in the World Championship record, each with a race-by-race career." });
}
