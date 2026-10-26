import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Every season since 1950. Champions, rounds and full standings for every World Championship season.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Results", title: "Every season since 1950", subtitle: "Champions, rounds and full standings for every World Championship season." });
}
