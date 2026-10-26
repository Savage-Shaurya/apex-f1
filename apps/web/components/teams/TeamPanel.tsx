import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Portrait } from '@/components/ds';
import { formatPoints } from '@/components/drivers/people';
import { CarStage, TeamLogo } from './carbon/CarStage';
import { fitDisplay, ShareBar } from './carbon/parts';

export interface TeamPanelData {
  slug: string;
  name: string;
  color: string;
  position: number;
  points: number;
  wins: number;
  gap: number | null;
  /** Leader's points, for the share bar. */
  leaderPoints: number;
  car: string | null;
  logo: string | null;
  season: number | null;
  /** points: scored for this team (null = split unavailable); shared: also raced for another team this season. */
  drivers: Array<{ slug: string; firstName: string; lastName: string; cutout: string | null; headshot: string | null; points: number | null; shared?: boolean }>;
}

/**
 * One constructor in championship order, Carbon & Light: a carbon bay with
 * the team's colour as the light behind its real car (shown whole, lit, on a
 * gloss floor), the white logo, the numbers in timing type, a points bar
 * against the leader, and the season's drivers as lit portraits.
 */
export function TeamPanel({ t, priority = false }: { t: TeamPanelData; priority?: boolean }) {
  const pointsShare = t.leaderPoints > 0 ? t.points / t.leaderPoints : 0;
  return (
    <article id={`team-${t.slug}`} aria-labelledby={`team-${t.slug}-name`} className="group relative isolate scroll-mt-24 overflow-hidden border-t border-[color:var(--bc-rule)]" style={{ '--team': t.color } as CSSProperties}>
      <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-60" />
      {/* the team's light, pooled behind the car */}
      <div aria-hidden className="absolute -z-10 inset-y-[-20%] right-[-15%] w-[95%] bg-[radial-gradient(ellipse_50%_46%_at_55%_52%,color-mix(in_srgb,var(--team)_26%,transparent),transparent_72%)] lg:w-[70%]" />
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: t.color }} />
      <div className="ds-container py-10 md:py-12 lg:py-14">
        <div className="grid grid-cols-1 gap-y-6 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-0">
          <div className="min-w-0 lg:col-span-5 lg:row-start-1 lg:self-end">
            <div className="flex items-center justify-between gap-4">
              <p className="bc-display text-[clamp(2.6rem,5vw,4rem)] leading-none text-[color:var(--bc-white)]">
                <span className="sr-only">Position </span>P{t.position}
              </p>
              <TeamLogo src={t.logo} name={t.name} color={t.color} className="h-12 w-20 md:h-14 md:w-24" />
            </div>
            <div className="mt-4 [container-type:inline-size]">
              <h2 id={`team-${t.slug}-name`} className="bc-display text-[color:var(--bc-white)]" style={{ fontSize: fitDisplay(t.name, 'clamp(1.9rem, 1.1rem + 2.4vw, 3.4rem)') }}>
                <Link href={`/teams/${t.slug}`} className="underline-offset-[0.14em] decoration-2 hover:underline">{t.name}</Link>
              </h2>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-7 lg:col-start-6 lg:row-span-2 lg:row-start-1 lg:self-center">
            <CarStage
              src={t.car}
              alt={t.season ? `${t.name} ${t.season} car, side view` : `${t.name} car, side view`}
              color={t.color}
              priority={priority}
              glare
              field={false}
              sizes="(max-width: 1024px) 92vw, 54vw"
            />
          </div>
          <div className="min-w-0 lg:col-span-5 lg:row-start-2 lg:self-start">
            <dl className="mt-2 grid lg:mt-6 grid-cols-3 gap-4">
              <div>
                <dt className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">Points</dt>
                <dd className="bc-mono mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] leading-none text-white">{formatPoints(t.points)}</dd>
              </div>
              <div>
                <dt className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">Wins</dt>
                <dd className="bc-mono mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] leading-none text-white">{t.wins}</dd>
              </div>
              <div>
                <dt className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">{t.gap === null ? 'Leader' : 'To leader'}</dt>
                <dd className="bc-mono mt-1.5 text-[clamp(1.5rem,2.4vw,2rem)] leading-none text-white">{t.gap === null ? 'P1' : `−${formatPoints(t.gap)}`}</dd>
              </div>
            </dl>
            <ShareBar share={pointsShare} color={t.color} className="mt-5" />
            {t.drivers.length > 0 && (
              // Two drivers side by side only when the card itself is wide enough for whole surnames (VERSTAPPEN).
              <div className="@container mt-7">
              <ul className="grid grid-cols-1 gap-x-5 gap-y-4 @[25rem]:grid-cols-2">
                {t.drivers.map((d) => (
                  <li key={d.slug} className="min-w-0">
                    <Link href={`/drivers/${d.slug}`} className="group/driver flex min-h-11 items-center gap-3">
                      <Portrait
                        src={d.cutout ?? d.headshot}
                        fallbackSrc={d.headshot}
                        name={`${d.firstName} ${d.lastName}`}
                        alt=""
                        framing="head"
                        teamColor={d.cutout || d.headshot ? t.color : null}
                        emptyLabel={null}
                        sizes="72px"
                        className="w-14 shrink-0 sm:w-[4.5rem]"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="break-words text-[0.82rem] text-[color:var(--bc-silver)]">{d.firstName}</span>
                        <span className="break-words text-[0.95rem] font-bold uppercase tracking-[0.03em] text-white underline-offset-4 group-hover/driver:underline">{d.lastName}</span>
                        <span className="bc-mono text-[0.78rem] text-[color:var(--bc-titanium)]">
                          {d.points === null ? 'Points unavailable' : `${formatPoints(d.points)} ${d.points === 1 ? 'pt' : 'pts'}${d.shared ? ' here' : ''}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
