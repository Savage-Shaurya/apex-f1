import type { Metadata } from 'next';
import '@/components/brand-c/brand-c.css';
import { loadBrandC } from '@/components/brand-c/data';
import { tolerateBuildOutages } from '@/lib/grid';
import { Hero } from '@/components/brand-c/Hero';
import { NewsHero } from '@/components/brand-c/NewsHero';
import { selectHeroSlides } from '@/components/brand-c/news-hero';
import { getHomeFeed } from '@/lib/home-feed';
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
 * Home, Carbon & Light. The first screen is the news desk: the newest real
 * Formula 1 stories rotating on their publishers' pictures (fewer than three
 * and it falls back to the race hero below). Under it, and in the race hero,
 * the page answers what just happened (the
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
  // The feed is request-cached (lib/home-feed), so this is the same read loadBrandC makes.
  const [data, feed] = await Promise.all([loadBrandC(), getHomeFeed().catch(() => null)]);
  // The rotating news desk needs three real F1 stories with pictures; otherwise the race hero shows.
  const slides = selectHeroSlides(feed, data.now);
  return (
    <div className="bc relative" data-home="carbon-light">
      {slides ? <NewsHero slides={slides} data={data} /> : <Hero data={data} />}
      <RaceWeekend data={data} />
      <Championship data={data} />
      <SeasonRail data={data} />
      <GiveBack />
      <ScrollMotion />
    </div>
  );
}
