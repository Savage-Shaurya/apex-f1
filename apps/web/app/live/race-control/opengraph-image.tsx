import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Race control log. Flags, safety cars and stewards’ decisions from the latest finished session.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Timing", title: "Race control log", subtitle: "Flags, safety cars and stewards’ decisions from the latest finished session." });
}
