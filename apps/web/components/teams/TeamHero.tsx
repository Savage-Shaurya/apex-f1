import type { CSSProperties, ReactNode } from 'react';
import { Breadcrumbs } from '@/components/ds';
import { Floodlights } from '@/components/brand-c/stages';
import { teamHeroVisual } from '@/components/hero/hero-visual';
import { CarStage, TeamLogo } from './carbon/CarStage';
import { fitDisplay, Kicker, TeamTabs } from './carbon/parts';
import { TeamEmblem } from './TeamEmblem';
import { TeamHeroPhoto } from './TeamHeroPhoto';

export interface TeamHeroPhoto {
  src: string;
  alt: string;
}

/**
 * Team hero, Carbon & Light: night carbon, the floodlight from above (WebGL
 * rays on capable desktops, the same light in CSS everywhere else), the
 * team's colour as the light field, the white logo, the name fitted to its
 * column (never broken mid-word), the numbers in timing type, and always a
 * real picture of the team (TEAMS-2, TEAMS-3): the F1 media car whole on a
 * gloss floor; for a historic team, a real credited Wikimedia Commons
 * photograph of its car (credited on /references); with neither, the team's
 * emblem in light (its colour and its name in outline), never an empty field
 * (also when the photograph fails to load).
 * On phones the picture comes straight after the name, before the numbers,
 * so it is in the first screen (TEAMS-low).
 */
export function TeamHero({
  slug,
  name,
  color,
  logo,
  car,
  carAlt,
  photo = null,
  crumbs,
  meta,
  stats,
  tab,
  compact = false,
}: {
  slug: string;
  name: string;
  color: string | null;
  logo: string | null;
  car: string | null;
  carAlt: string;
  /** Real Commons photograph of the team's car, for teams with no F1 media car. */
  photo?: TeamHeroPhoto | null;
  crumbs: { label: string; href?: string }[];
  meta: string[];
  stats?: ReactNode;
  tab: 'profile' | 'history';
  compact?: boolean;
}) {
  const team = color ?? '#6b6e76';
  const visual = teamHeroVisual({ car, photo: photo?.src });
  return (
    <section aria-labelledby="team-name" data-team-visual={visual} className="relative isolate overflow-hidden" style={{ '--team': team } as CSSProperties}>
      <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
      {color && <div aria-hidden className="absolute inset-x-[-10%] top-[10%] -z-10 h-[90%] bg-[radial-gradient(ellipse_48%_42%_at_60%_62%,color-mix(in_srgb,var(--team)_30%,transparent),transparent_72%)]" />}
      <Floodlights className="pointer-events-none absolute inset-0 -z-10 [&>div]:absolute [&>div]:inset-0" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/4 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
      <div className={`ds-container ${compact ? 'pb-10 pt-4' : 'pb-12 pt-4 md:pb-16'}`}>
        <Breadcrumbs items={crumbs} className="[&_a]:text-[color:var(--bc-silver)] [&_span]:text-[color:var(--bc-silver)]" />
        <div className="mt-6 grid grid-cols-1 items-end gap-y-8 md:mt-8 lg:grid-cols-12 lg:gap-x-10">
          <div className={`order-1 min-w-0 ${stats ? 'lg:col-span-7' : 'lg:col-span-12'}`}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* Left-aligned in its box, so the mark lines up with the name under it (TEAMS-low). */}
              <TeamLogo src={logo} name={name} color={color} className="tc-hero-logo h-14 w-24 md:h-16 md:w-28" />
              <Kicker>{meta.map((m, i) => <span key={m} className="flex items-center gap-3">{i > 0 && <span aria-hidden className="text-[color:var(--bc-titanium)]">/</span>}{m}</span>)}</Kicker>
            </div>
            <div className="mt-5 [container-type:inline-size]">
              <h1 id="team-name" className="bc-display text-[color:var(--bc-white)]" style={{ fontSize: fitDisplay(name, compact ? 'clamp(2.4rem, 1rem + 5.4vw, 6rem)' : 'clamp(2.6rem, 0.8rem + 7vw, 8rem)') }}>
                {name}
              </h1>
            </div>
          </div>
          {stats && <div className="order-3 min-w-0 lg:order-2 lg:col-span-5 lg:pb-2">{stats}</div>}
          <div className="order-2 min-w-0 lg:order-3 lg:col-span-12">
            {visual === 'car' && (
              <CarStage
                src={car}
                alt={carAlt}
                color={color}
                priority
                sizes={compact ? '(max-width: 1024px) 92vw, 960px' : '(max-width: 1680px) 94vw, 1500px'}
                className={compact ? 'mx-auto max-w-[960px] lg:mt-2' : 'mx-auto max-w-[1400px] lg:mt-4'}
                field={false}
              />
            )}
            {/* A photo that fails to load falls back to the emblem, never an empty hero (review 2026-11-01). */}
            {visual === 'photo' && photo && <TeamHeroPhoto src={photo.src} alt={photo.alt} name={name} compact={compact} />}
            {visual === 'emblem' && <TeamEmblem name={name} compact={compact} />}
          </div>
        </div>
        <div className="mt-8 md:mt-10">
          <TeamTabs slug={slug} current={tab} />
        </div>
      </div>
    </section>
  );
}
