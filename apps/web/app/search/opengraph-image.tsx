import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Search Formula 1 history. Every driver since 1950, every constructor, every season.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Search", title: "Search Formula 1 history", subtitle: "Every driver since 1950, every constructor, every season." });
}
