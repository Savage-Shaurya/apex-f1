import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';
import { driversIndexCard } from '@/lib/og/cards';

// Share image (final audit F-04): real data, redrawn at most hourly.
export const alt = "Apex drivers card: the current grid and the championship leader";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const revalidate = 3600;

export default async function Image() {
  return renderOgCard(await driversIndexCard());
}
