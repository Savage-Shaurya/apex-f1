import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Latest Formula 1 news. World Championship stories from trusted newsrooms, newest first.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "News", title: "Latest Formula 1 news", subtitle: "World Championship stories from trusted newsrooms, newest first." });
}
