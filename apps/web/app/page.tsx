import type { Metadata } from 'next';
import '@/components/brand-c/brand-c.css';
import { loadBrandC } from '@/components/brand-c/data';
import { tolerateBuildOutages } from '@/lib/grid';
import { Hero } from '@/components/brand-c/Hero';
import { RaceWeekend } from '@/components/brand-c/RaceWeekend';
import { Championship } from '@/components/brand-c/Championship';
import { SeasonRail } from '@/components/brand-c/SeasonRail';
import { GiveBack } from '@/components/brand-c/GiveBack';
import { ScrollMotion } from '@/components/brand-c/ScrollMotion';
import { withSocial } from '@/lib/page-metadata';

// A minute during and around race weekends matters: the hero, last race and standings follow
// the real session clock. Provider reads keep their own longer lifetimes outside weekends.
export const revalidate = 60;

export const metadata: Metadata = withSocial({
  alternates: { canonical: '/' },
});

/**
 * Home, Carbon & Light. The first screen answers what just happened (the
 * podium under floodlights for four days after a Grand Prix, otherwise the
 * countdown to the next session), what's next and why it matters (the title
 * maths from the published points). Then the race weekend, the championship,
 * every round of the season and Give back. Every value comes from the
 * providers the product already uses; a missing value renders a truthful
 * unavailable state. The hero re-reads its data on its own.
 */
export default async function HomePage() {
  // A provider outage while `next build` prerenders must not make the home
  // dynamic for the whole deployment (lib/grid.ts tolerateBuildOutages).
  tolerateBuildOutages();
  const data = await loadBrandC();
  return (
    <div className="bc relative" data-home="carbon-light">
      <Hero data={data} />
      <RaceWeekend data={data} />
      <Championship data={data} />
      <SeasonRail data={data} />
      <GiveBack />
      <ScrollMotion />
    </div>
  );
}
