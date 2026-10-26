import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Formula 1 video. The latest films from verified Formula 1 YouTube channels.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Video", title: "Formula 1 video", subtitle: "The latest films from verified Formula 1 YouTube channels." });
}
