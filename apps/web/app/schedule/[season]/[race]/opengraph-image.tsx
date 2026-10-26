import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';
import { raceCard } from '@/lib/og/cards';

// Share image (final audit F-04): real data, redrawn at most hourly.
export const alt = "Apex race card: Grand Prix name, round, circuit and the podium or race start";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ season: string; race: string }> }) {
  const p = await params;
  return renderOgCard(await raceCard(p.season, p.race));
}
