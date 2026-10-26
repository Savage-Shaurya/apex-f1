import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';
import { teamCard } from '@/lib/og/cards';

// Share image (final audit F-04): real data, redrawn at most hourly.
export const alt = "Apex team card: name, drivers and this season's position, points and wins";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const p = await params;
  return renderOgCard(await teamCard(p.slug, 'profile'));
}
