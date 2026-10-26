import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: World champions. Every Formula 1 World Drivers’ Champion since 1950.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Drivers", title: "World champions", subtitle: "Every Formula 1 World Drivers’ Champion since 1950." });
}
