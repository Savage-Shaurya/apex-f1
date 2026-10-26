import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Every constructor since 1950. Every constructor in the World Championship record since 1950.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Teams", title: "Every constructor since 1950", subtitle: "Every constructor in the World Championship record since 1950." });
}
