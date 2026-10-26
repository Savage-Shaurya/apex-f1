import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Every life deserves a pit crew. Apex is free. It asks one small kindness for an animal near you.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Give back", title: "Every life deserves a pit crew", subtitle: "Apex is free. It asks one small kindness for an animal near you." });
}
