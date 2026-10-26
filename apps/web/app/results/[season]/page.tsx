import { notFound, permanentRedirect } from 'next/navigation';

/** /results/[season] has no content of its own; it opens that season's driver standings. */
export default async function SeasonIndexPage({ params }: { params: Promise<{ season: string }> }) {
  const { season } = await params;
  if (!/^\d{4}$/.test(season)) notFound();
  permanentRedirect(`/results/${season}/drivers`);
}
