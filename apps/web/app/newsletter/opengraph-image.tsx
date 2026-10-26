import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Race week briefing. One short email the Friday before each Formula 1 race.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Newsletter", title: "Race week briefing", subtitle: "One short email the Friday before each Formula 1 race." });
}
