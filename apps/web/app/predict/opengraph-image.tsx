import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Call the grid. Pole, the winner, a podium and fastest lap, scored against the official result.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Grid Predict", title: "Call the grid", subtitle: "Pole, the winner, a podium and fastest lap, scored against the official result." });
}
