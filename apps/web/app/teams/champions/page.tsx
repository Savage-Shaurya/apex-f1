import type { Metadata } from 'next';
import { Suspense } from 'react';
import { mapConstructorStanding } from '@apex/api-client/jolpica';
import { loadConstructorChampionshipArchive } from '@/components/data/load-championship-archive';
import { CONSTRUCTOR_TITLE_ALIASES } from '@/lib/constructor-titles';
import { getSeasonContext } from '@/lib/season';
import { getTeamMedia } from '@/lib/f1-media';
import { NEUTRAL_TEAM_COLOUR } from '@/lib/team-colours';
import Link from 'next/link';
import '@/components/brand-c/brand-c.css';
import '@/components/teams/carbon/teams.css';
import { Section, Text, Unavailable } from '@/components/ds';
import { Floodlights } from '@/components/brand-c/stages';
import { PressLink } from '@/components/brand-c/Press';
import { CarStage } from '@/components/teams/carbon/CarStage';
import { fitDisplay, Kicker } from '@/components/teams/carbon/parts';
import { ChampionsHall, type HallEntry, type HallLeader } from '@/components/drivers/hall/ChampionsHall';
import { HallSkeleton } from '@/components/drivers/Skeletons';
import { cleanName, formatPoints } from '@/components/drivers/people';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

// The archive is a committed snapshot plus a cached live merge, so the page is
// regenerated hourly (PERF2-5); an incomplete merge calls connection() and renders per request.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { lastCompletedSeason } = await getSeasonContext();
  return withSocial({
    title: 'Formula 1 constructor champions',
    description: `Every Formula 1 Constructors' Champion from 1958, when the title was first awarded, to ${lastCompletedSeason}, with the most successful teams.`,
    alternates: { canonical: '/teams/champions' },
  });
}

type Archive = Awaited<ReturnType<typeof loadConstructorChampionshipArchive>>;

function rowsOf(archive: Archive) {
  return archive.records.map(({ year, winner }) => {
    const s = mapConstructorStanding(winner);
    const marque = CONSTRUCTOR_TITLE_ALIASES[s.constructor.slug] ?? s.constructor.slug;
    return {
      year,
      slug: s.constructor.slug,
      marque,
      name: cleanName(s.constructor.name),
      nationality: s.constructor.nationality,
      // Team colours are this season's liveries; a completed title season never wears them.
      color: NEUTRAL_TEAM_COLOUR,
      points: s.points,
      wins: s.wins,
    };
  });
}

async function Hall({ through, nowSeason }: { through: number; nowSeason: number }) {
  const archive = await loadConstructorChampionshipArchive(through);
  if (archive.state !== 'complete') await outageConnection();
  const rows = rowsOf(archive);
  if (!rows.length) {
    return (
      <Section spacing="tight">
        <Unavailable title="Constructor champions unavailable" action={{ label: 'Open the results archive', href: '/results/archive' }}>
          {archive.state === 'empty' ? 'No completed championship is on record yet.' : 'The champions can\'t be shown right now. Please check back in a few minutes.'}
        </Unavailable>
      </Section>
    );
  }
  const recent = rows.filter((r) => r.year >= 2024);
  const media = await Promise.all(recent.map((r) => getTeamMedia(r.year, r.slug)));
  const carByYear = new Map(recent.map((r, i) => [r.year, media[i]?.car ?? null]));
  // The marque's display name is its own id's name when it has one (Lotus-Climax counts for Team Lotus).
  const marqueName = new Map<string, string>();
  for (const r of rows) if (r.slug === r.marque) marqueName.set(r.marque, r.name);

  const entries: HallEntry[] = rows.map((r) => {
    const car = carByYear.get(r.year);
    return {
      year: r.year,
      key: r.marque,
      name: r.name,
      href: `/teams/${r.marque}`,
      resultsHref: `/results/${r.year}/teams`,
      team: null,
      nationality: r.nationality,
      points: r.points,
      wins: r.wins,
      picture: car ? { kind: 'car', src: car } : null,
    };
  });
  const byMarque = new Map<string, HallLeader>();
  for (const r of rows) {
    const l = byMarque.get(r.marque) ?? { key: r.marque, name: marqueName.get(r.marque) ?? r.name, href: `/teams/${r.marque}`, years: [] };
    l.years.push(r.year);
    byMarque.set(r.marque, l);
  }
  const top = Array.from(byMarque.values()).sort((a, b) => b.years.length - a.years.length || a.years[0]! - b.years[0]!).slice(0, 6);
  // On the plinth: the team's current car from Formula 1 media when it still races; a historic team stands in type.
  const nowMedia = await Promise.all(top.map((l) => getTeamMedia(nowSeason, l.key)));
  const leaders: HallLeader[] = top.map((l, i) => {
    const m = nowMedia[i];
    return { ...l, picture: m?.car ? { kind: 'car', src: m.car } : null, pictureNote: m?.car ? `${nowSeason} car` : null };
  });
  return (
    <>
      {archive.missing.length > 0 && (
        <Section spacing="none" className="pb-10">
          <Unavailable compact title="Some seasons are missing">
            The champions of {archive.missing.join(', ')} can&apos;t be shown right now, so the counts below are partial.
          </Unavailable>
        </Section>
      )}
      <ChampionsHall entries={entries.map((e) => ({ ...e, name: e.name }))} leaders={leaders} kind="constructor" hallId="constructor-hall" />
      <Section spacing="tight">
        <Text size="small" tone="subtle" className="max-w-[70ch]">Title counts fold engine-named entries (such as Lotus-Climax and Cooper-Climax) into their team. The current season is never counted as a title.</Text>
      </Section>
    </>
  );
}

async function Newest({ through }: { through: number }) {
  const archive = await loadConstructorChampionshipArchive(through);
  const rows = rowsOf(archive);
  const last = rows.reduce<(typeof rows)[number] | null>((a, r) => (!a || r.year > a.year ? r : a), null);
  if (!last) return null;
  const media = last.year >= 2024 ? await getTeamMedia(last.year, last.slug) : null;
  const titles = rows.filter((r) => r.marque === last.marque).length;
  return (
    <figure className="m-0 min-w-0">
      {media?.car && <CarStage src={media.car} alt={`${last.name} ${last.year} car, side view`} color={null} priority sizes="(max-width: 1024px) 92vw, 46vw" />}
      <figcaption className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <span className="min-w-0">
          <span className="bc-label block text-[color:var(--bc-titanium)]">Newest champion</span>
          <span className="bc-mono mt-2 block text-[clamp(2.6rem,5vw,4rem)] leading-none text-white">{last.year}</span>
        </span>
        <span className="min-w-0 sm:text-right">
          <Link href={`/teams/${last.marque}`} className="bc-wide inline-flex min-h-11 items-center text-[1.5rem] text-white underline-offset-4 hover:underline">{last.name}</Link>
          <span className="bc-mono block text-[0.85rem] text-[color:var(--bc-silver)]">{last.wins} wins · {formatPoints(last.points)} pts{titles > 1 ? ` · title ${titles}` : ''}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export default async function ConstructorChampionsPage() {
  const { lastCompletedSeason: through, resultsSeason } = await getSeasonContext();
  return (
    <div className="bc relative">
      <section aria-labelledby="champions-title" className="relative isolate overflow-hidden">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <Floodlights className="pointer-events-none absolute inset-y-0 -left-[10%] -right-[10%] -z-10 lg:left-[40%] [&>div]:absolute [&>div]:inset-0" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
        <div className="ds-container grid grid-cols-1 items-end gap-y-10 pb-14 pt-10 md:pt-14 lg:grid-cols-12 lg:gap-x-10 lg:pb-20 lg:pt-16">
          <div className="min-w-0 lg:col-span-6">
            <Kicker>Constructors&apos; champions · 1958 to {through}</Kicker>
            <div className="mt-5 [container-type:inline-size]">
              <h1 id="champions-title" className="bc-display text-white" style={{ fontSize: fitDisplay('Constructor champions', 'clamp(2.6rem, 1.2rem + 4.6vw, 6rem)') }}>Constructor champions</h1>
            </div>
            <p className="mt-5 max-w-[46ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">Every Constructors&apos; Champion since the title was first awarded in 1958, through {through}.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <PressLink href={`/results/${resultsSeason}/teams`} variant="solid">{resultsSeason} standings <span aria-hidden>→</span></PressLink>
              <PressLink href="/drivers/champions" variant="ghost">Driver champions</PressLink>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-6">
            <Suspense fallback={<div className="aspect-[1200/330] w-full" />}>
              <Newest through={through} />
            </Suspense>
          </div>
        </div>
      </section>
      <Suspense fallback={<HallSkeleton />}>
        <Hall through={through} nowSeason={resultsSeason} />
      </Suspense>
    </div>
  );
}
