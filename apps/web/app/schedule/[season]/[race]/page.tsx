import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { UiRace } from '@apex/api-client/jolpica';
import { Breadcrumbs, Heading, Section, Unavailable } from '@/components/ds';
import { CircuitSvg } from '@/components/circuit/CircuitSvg';
import { Conditions } from '@/components/race/Conditions';
import { LiveRefresh } from '@/components/freshness/LiveRefresh';
import { RACE_CORRECTION_WATCH_MS } from '@/lib/data-freshness';
import { LAPS_FROM, LapStory } from '@/components/race/LapStory';
import { loadSessionWeather, loadWeekendExtras } from '@/components/race/data';
import { CircuitStage } from '@/components/race/CircuitStage';
import { loadLayoutEras, type LayoutEra } from '@/components/race/circuit-history';
import { SectionHead } from '@/components/race/SectionHead';
import { makeColourOf, ResultsSheet } from '@/components/race/ResultsSheet';
import { RaceHero } from '@/components/race/RaceHero';
import { ClockName, ClockToggle, SessionClockProvider } from '@/components/race/SessionClock';
import { WeekendSchedule, type SessionTop } from '@/components/race/WeekendSchedule';
import { circuitTimeZone } from '@/components/race/circuit-timezones';
import { factsForRound, roundLayout } from '@/components/race/round-layouts';
import { parseGmtOffset, raceResultsState, weekendDates, weekendPhase, weekendSessions, zoneOffsetMinutes } from '@/components/race/weekend';
import { requestNow } from '@/components/schedule/data';
import { siteOrigin } from '@/components/shell/site-metadata';
import { circuitPath, getCircuit } from '@/lib/circuits';
import { circuitFactsKey, formatLapLength, loadCircuitFacts } from '@/lib/circuits/facts';
import { getCircuitHeroImage } from '@/lib/commons-image';
import { getStandingsSeason, getTeamColours } from '@/lib/grid';
import { safeJsonLd } from '@/lib/json-ld';
import { bestRendition } from '@/lib/image-renditions';
import { loadRaceResults, raceDetailMetadata } from '@/lib/race-detail';
import { loadRaceCalendarCached } from '@/components/schedule/season-route';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

// Race-weekend pages rebuild at most a minute after a visit finds them stale; the
// weekend-watch cron also revalidates them the moment a classification lands.
export const revalidate = 60;
// ISR for every path: none is built ahead, each is rendered on its first visit and then
// served from cache for `revalidate` seconds. Without this export the route renders per request.
export async function generateStaticParams() {
  return [];
}

type RouteParams = { season: string; race: string };

const loadCalendar = loadRaceCalendarCached;

export async function generateMetadata(props: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { season, race } = await props.params;
  const calendar = await loadCalendar(Number(season), race);
  if (calendar.state === 'unavailable') await outageConnection();
  const base = raceDetailMetadata(calendar);
  if (calendar.state !== 'found') return base;
  const r = calendar.race;
  return withSocial({
    ...base,
    title: `${r.name} ${r.season}: sessions, results and circuit`,
    description: `Round ${r.round} of the ${r.season} Formula 1 season at ${r.circuitName}, ${r.city}, ${r.country}: session times, classification, qualifying, weather and the circuit.`,
  });
}

/** A session read that came back with rows. */
const has = (read: { state: string; data?: unknown }) => read.state === 'available' && Array.isArray(read.data) && read.data.length > 0;

const routeOf = (r: UiRace) => `/schedule/${r.season}/${r.routeSlug ?? r.slug}`;

export default async function RaceWeekendPage(props: { params: Promise<RouteParams> }) {
  const { season, race: raceSlug } = await props.params;
  const seasonNum = Number(season);
  const calendar = await loadCalendar(seasonNum, raceSlug);
  if (calendar.state === 'missing') notFound();
  if (calendar.state === 'unavailable') {
    await outageConnection();
    return (
      <Section tone="carbon" className="min-h-[100svh]" spacing="default">
        {/* Fills the viewport like the loading skeleton it replaces: the footer never jumps up into view (CLS). */}
        <Breadcrumbs items={[{ label: 'Schedule', href: '/schedule' }, { label: String(seasonNum), href: `/schedule/${seasonNum}` }, { label: 'Race weekend' }]} />
        <Heading level={1} className="mt-6">Race weekend unavailable</Heading>
        <Unavailable className="mt-10 max-w-[60rem]" title="Race details unavailable" action={{ label: 'Try again', href: `/schedule/${seasonNum}/${raceSlug}` }}>
          This race weekend can’t be shown right now. Please check back in a few minutes.
        </Unavailable>
      </Section>
    );
  }

  const { race, races } = calendar;
  const now = requestNow();
  const idx = races.indexOf(race);
  const prev = idx > 0 ? races[idx - 1] : null;
  const next = idx >= 0 && idx < races.length - 1 ? races[idx + 1] : null;
  const raceStarted = Date.parse(race.raceStartIso) <= now;

  const [classification, hero, circuitFacts, live] = await Promise.all([
    raceStarted ? loadRaceResults(race) : Promise.resolve({ state: 'not-run' as const }),
    getCircuitHeroImage({ circuitWikiUrl: race.circuitWikiUrl, circuitName: race.circuitName }),
    loadCircuitFacts([race, prev, next].filter((r): r is UiRace => r != null), { now }),
    getStandingsSeason(),
  ]);
  if (classification.state === 'unavailable') await outageConnection();
  const results = classification.state === 'available' ? classification.results : [];
  const [extras, colours, eras] = await Promise.all([
    loadWeekendExtras(race, now, results.length > 0),
    live.season === race.season ? getTeamColours() : Promise.resolve({}),
    loadLayoutEras(race.circuitWikiUrl),
  ]);
  // A session read that failed is never kept for the ISR window: this request renders dynamically.
  if ([extras.qualifying, extras.sprint, extras.pitStops].some((read) => read.state === 'unavailable')) await outageConnection();
  const colourOf = makeColourOf(colours);

  const sessions = weekendSessions(race.sessions, now, extras.openf1Sessions);
  const weather = await loadSessionWeather(race, sessions, now);
  const phase = weekendPhase(sessions);
  const raceDone = sessions.find((s) => s.kind === 'R')?.phase === 'finished' || (raceStarted && results.length > 0);
  const raceSession = sessions.find((s) => s.kind === 'R');
  const resultsState = raceResultsState({ read: classification.state === 'unavailable' ? 'unavailable' : classification.state === 'available' ? 'available' : 'not-run', rows: results.length, raceDone, raceStartIso: raceSession?.iso ?? race.raceStartIso, raceEndIso: raceSession?.endIso ?? null, now });
  // Track time: OpenF1's published offset, else the circuit's own zone (OpenF1 refuses every read while any session is live).
  const offset = parseGmtOffset(extras.openf1Sessions[0]?.gmt_offset) ?? zoneOffsetMinutes(circuitTimeZone(race.circuitId, race.country), race.raceStartIso);
  const facts = factsForRound(race, circuitFacts.get(circuitFactsKey(race)));
  const showOutline = (r: UiRace) => factsForRound(r, circuitFacts.get(circuitFactsKey(r)))?.showOutline === true;
  const altLayout = roundLayout(race);
  const sprintWeekend = race.sessions.some((s) => s.kind === 'S');
  // Upcoming and current weekends say how fresh they are and refresh themselves; history does not need to.
  const showFreshness = Date.parse(race.raceStartIso) + RACE_CORRECTION_WATCH_MS + 2 * 3_600_000 > now;
  const timed = race.sessions.some((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x.iso));

  const zone = circuitTimeZone(race.circuitId, race.country);
  const dateOnlyRace = /^\d{4}-\d{2}-\d{2}$/.test(race.raceStartIso);
  const geometry = facts?.showOutline ? getCircuit(race.circuitId) : null;
  // Name only what the provider has actually published (a race can have run before its classification exists).
  const published = [has(extras.sprint) ? 'the sprint' : null, has(extras.qualifying) ? 'qualifying' : null, has(extras.pitStops) ? 'pit stops' : null].filter((x): x is string => x != null);
  const joinList = (parts: string[]) => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  const resultsIntro = results.length > 0
    ? `Final classification of the ${race.season} ${race.name}${published.length ? `, with ${joinList(published)}` : ''}.`
    : classification.state === 'unavailable'
      ? 'The race classification can’t be shown right now. Please try again in a few minutes.'
    : raceDone
      ? `${resultsState === 'unavailable'
        ? 'The race has finished, but its classification can’t be loaded right now.'
        : resultsState === 'not-published'
          ? 'No classification has been published for this race.'
          : 'The race has finished. Its classification arrives shortly after the chequered flag.'}${published.length ? ` ${joinList(published).replace(/^the /, 'The ').replace(/^q/, 'Q').replace(/^p/, 'P')} ${published.length === 1 && published[0] !== 'pit stops' ? 'is' : 'are'} below.` : ''}`
      : 'Each session’s final timing appears here after it finishes.';
  const mapNote = altLayout
    ? `This round used the ${altLayout.layoutName} (${altLayout.lengthKm} km); its layout map is not shown.`
    : facts?.layoutName
    ? `In ${race.season} the race ran on an earlier layout, ${facts.layoutName}; its map is not shown.`
    : `A layout map of ${race.circuitName} is not available.`;
  const heroPhoto = hero
    ? {
        src: hero.src,
        width: hero.width,
        height: hero.height,
        credit: {
          label: `Photo: ${[hero.credit.author, hero.credit.license].filter(Boolean).join(', ') || 'Wikimedia Commons'} (Wikimedia Commons)`,
          href: hero.credit.sourceUrl,
        },
      }
    : null;
  // With no verified outline the circuit's photograph takes the hero's stage (and is not repeated below).
  const photoInHero = !geometry && heroPhoto != null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${race.name} ${race.season}`,
    startDate: race.raceStartIso,
    location: { '@type': 'Place', name: race.circuitName, address: { '@type': 'PostalAddress', addressLocality: race.city, addressCountry: race.country } },
    sport: 'Formula 1',
    url: `${siteOrigin()}${routeOf(race)}`,
  };

  const factRows: Array<[string, string]> = [
    ['Circuit', race.circuitName],
    ['Location', `${race.city}, ${race.country}`],
    ['Lap length', formatLapLength(facts)],
    ['Format', sprintWeekend ? 'Sprint weekend' : 'Conventional weekend'],
    ['Round', `${race.round} of ${races.length}`],
    ['Coordinates', Number.isFinite(race.lat) && Number.isFinite(race.lon) ? `${Math.abs(race.lat).toFixed(3)}° ${race.lat >= 0 ? 'N' : 'S'}, ${Math.abs(race.lon).toFixed(3)}° ${race.lon >= 0 ? 'E' : 'W'}` : 'Not published'],
  ];

  const topOf = (rows: Array<{ code: string | null; last: string; slug?: string }>): SessionTop[] => rows.slice(0, 3).map((r) => ({ code: r.code, last: r.last, color: colourOf(r.slug) }));
  const tops: Partial<Record<string, SessionTop[]>> = {
    ...(results.length ? { R: topOf(results.map((r) => ({ code: r.driver.code || null, last: r.driver.lastName, slug: r.constructor?.slug }))) } : {}),
    ...(extras.sprint.state === 'available' && extras.sprint.data.length ? { S: topOf(extras.sprint.data.map((r) => ({ code: r.Driver.code?.trim() || null, last: r.Driver.familyName, slug: r.Constructor?.constructorId }))) } : {}),
    ...(extras.qualifying.state === 'available' && extras.qualifying.data.length ? { Q: topOf(extras.qualifying.data.map((r) => ({ code: r.Driver.code?.trim() || null, last: r.Driver.familyName, slug: r.Constructor?.constructorId }))) } : {}),
  };
  const lapKm = facts?.lengthKm ?? null;

  return (
    <SessionClockProvider offsetMin={offset} zone={zone} trackLabel={offset != null || zone ? `${race.city} time` : null}>
      <article className="bc">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

        <RaceHero
          race={race}
          rounds={races.length}
          sprintWeekend={sprintWeekend}
          phase={phase}
          sessions={sessions}
          results={raceDone ? results : []}
          raceDone={raceDone}
          resultsState={resultsState}
          colourOf={colourOf}
          zone={zone}
          dates={{ label: zone || dateOnlyRace ? 'Weekend, local dates' : 'Weekend (UTC)', value: weekendDates(sessions[0]?.iso ?? race.raceStartIso, race.raceStartIso, zone) }}
          lapLength={formatLapLength(facts)}
          outline={geometry ? { d: circuitPath(geometry), width: geometry.width, height: geometry.height } : null}
          photo={photoInHero ? heroPhoto : null}
          mapNote={mapNote}
          resultsCta={results.length > 0 ? 'Full classification' : has(extras.qualifying) ? 'Qualifying results' : 'Results'}
        />

        {/* The weekend, session by session */}
        <section id="sessions" aria-labelledby="sessions-title" className="relative border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-carbon)] py-16 lg:py-24">
          <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[70%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.06),transparent)]" />
          <div className="ds-container relative">
            <SectionHead
              id="sessions-title"
              label={`Round ${race.round} · ${sprintWeekend ? 'Sprint weekend' : 'Race weekend'}`}
              title="Weekend"
              aside={timed ? <ClockToggle /> : undefined}
            >
              <p className="mt-3 text-[0.95rem] text-[color:var(--bc-silver)]">{timed ? <>Times in <ClockName reserve className="text-white" /></> : 'Start times were not recorded for this race, only the dates.'}</p>
            </SectionHead>
            <div className="mt-10 md:mt-12">
              <WeekendSchedule sessions={sessions} serverNow={now} weather={weather ? Object.fromEntries(weather) : null} tops={tops} />
            </div>
          </div>
        </section>

        {/* The timing sheets */}
        <section id="results" aria-labelledby="results-title" className="relative border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-16 lg:py-24">
          <div className="ds-container">
            <SectionHead id="results-title" label="Timing" title="Results">
              <p className="mt-3 max-w-[62ch] text-[0.98rem] leading-relaxed text-[color:var(--bc-silver)]">{resultsIntro}</p>
            </SectionHead>
            {showFreshness && (
              <LiveRefresh
                className="mt-3 !text-[color:var(--bc-titanium)]"
                stamp={false}
                renderedAt={now}
                sessions={sessions.map((s) => ({ kind: s.kind, startIso: s.iso, endIso: s.endIso }))}
                published={[has(extras.qualifying) ? 'Q' : null, has(extras.sprint) ? 'S' : null, results.length > 0 ? 'R' : null].filter((k): k is string => k !== null)}
              />
            )}
            <div className="mt-10 md:mt-12">
              <ResultsSheet
                raceName={race.name}
                season={race.season}
                race={classification.state === 'available' ? { state: 'available', results } : classification}
                raceDone={raceDone}
                sprint={extras.sprint}
                qualifying={extras.qualifying}
                pitStops={extras.pitStops}
                colourOf={colourOf}
                retryHref={routeOf(race)}
                raceStartIso={sessions.find((x) => x.kind === 'R')?.iso ?? race.raceStartIso}
                offsetMin={offset}
                sessionOrder={sessions.map((x) => x.kind)}
                resultsState={resultsState}
              />
            </div>
          </div>
        </section>

        {/* Lap by lap: the race as a bump chart, streamed on its own. */}
        {results.length > 0 && race.season >= LAPS_FROM && (
          <section id="laps" aria-labelledby="laps-title" className="border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-carbon)] py-16 lg:py-24">
            <div className="ds-container">
              <Suspense fallback={<div><SectionHead id="laps-title" label="The race" title="Lap by lap" /><div aria-label="Loading the lap-by-lap running order" className="mt-10 h-[30rem] w-full rounded-[18px] bg-[color:var(--bc-carbon-2)]" /></div>}>
                <LapStory season={race.season} round={race.round} results={results} pitStops={extras.pitStops.state === 'available' ? extras.pitStops.data : []} />
              </Suspense>
            </div>
          </section>
        )}

        {/* Conditions */}
        {Number.isFinite(race.lat) && Number.isFinite(race.lon) && (
          <section id="conditions" aria-labelledby="conditions-title" className="border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-16 lg:py-24">
            <div className="ds-container">
              <Suspense fallback={<div><SectionHead id="conditions-title" label="Weather at the circuit" title="Conditions" /><div aria-label="Loading the weekend weather" className="mt-10 h-56 w-full rounded-[22px] bg-[color:var(--bc-carbon-2)]" /></div>}>
                <Conditions lat={race.lat} lon={race.lon} raceStartIso={sessions.find((x) => x.kind === 'R')?.iso ?? race.raceStartIso} sessions={sessions.map(({ kind, iso }) => ({ kind, iso }))} season={race.season} now={now} />
              </Suspense>
            </div>
          </section>
        )}

        {/* The circuit */}
        <section id="circuit" aria-labelledby="circuit-title" className="relative overflow-hidden border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-carbon)] py-16 lg:py-24">
          <div className="ds-container">
            <SectionHead id="circuit-title" label={`${race.city}, ${race.country}`} title="The circuit">
              <p className="mt-3 text-[1rem] text-[color:var(--bc-silver)]">{race.circuitName}</p>
            </SectionHead>
            <div className="mt-10 grid gap-8 md:mt-12 lg:grid-cols-12 lg:gap-10">
              <div className="min-w-0 lg:col-span-7">
                {geometry ? (
                  <div className="relative overflow-hidden rounded-[22px] bg-[color:var(--bc-night)] ring-1 ring-[color:var(--bc-rule)]">
                    <div aria-hidden className="bc-carbon absolute inset-0 opacity-60" />
                    <div className="relative">
                      <CircuitStage circuitId={race.circuitId} d={circuitPath(geometry)} width={geometry.width} height={geometry.height} label={`Layout of ${race.circuitName}`} />
                    </div>
                  </div>
                ) : heroPhoto && !photoInHero ? null : (
                  <p className="max-w-[48ch] border-l-2 border-white/15 pl-5 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">{mapNote}</p>
                )}
                {heroPhoto && !photoInHero && (
                  <figure className={geometry ? 'mt-6' : ''}>
                    <div className="relative overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon-2)] ring-1 ring-[color:var(--bc-rule)]" style={{ aspectRatio: heroPhoto.width && heroPhoto.height ? `${heroPhoto.width} / ${heroPhoto.height}` : '16 / 9' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- Commons rendition chosen upstream; the box reserves the space */}
                      <img {...photoRendition(heroPhoto.src, heroPhoto.width)} alt={`Photograph of ${race.circuitName}`} loading="lazy" decoding="async" sizes="(max-width: 1024px) 100vw, 58vw" className="absolute inset-0 h-full w-full object-cover" />
                      <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_60%,rgb(5_5_6/0.8))]" />
                      <figcaption className="absolute inset-x-5 bottom-4">
                        <span className="bc-wide text-[0.9rem] text-white">{race.circuitName}</span>
                      </figcaption>
                    </div>
                  </figure>
                )}
              </div>
              <div className="min-w-0 lg:col-span-5">
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] bg-[color:var(--bc-rule)] ring-1 ring-[color:var(--bc-rule)]">
                  {factRows.map(([k, v]) => (
                    <div key={k} className="min-w-0 bg-[color:var(--bc-night)] p-5">
                      <dt className="bc-label text-[color:var(--bc-titanium)]">{k}</dt>
                      {/* Timing face for figures only: a word state ("Unavailable", "Not published") in the wider mono face splits across lines in the 320px half-cell. */}
                      <dd className={`mt-2 text-[1rem] leading-snug text-white [overflow-wrap:anywhere] ${(k === 'Lap length' || k === 'Round' || k === 'Coordinates') && /\d/.test(v) ? 'bc-mono' : ''}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <LapLengthByYear eras={eras} season={race.season} lapKm={lapKm} />
              </div>
            </div>
          </div>
        </section>

        {(prev || next) && (
          <nav aria-label="Adjacent rounds" className="border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-14 lg:py-20">
            <div className="ds-container">
              <div className="grid gap-4 md:grid-cols-2">
                {[{ r: prev, dir: 'Previous round' as const }, { r: next, dir: 'Next round' as const }].map(({ r, dir }) =>
                  r ? (
                    <Link key={dir} href={routeOf(r)} className={`group relative flex min-w-0 items-center gap-5 overflow-hidden rounded-[18px] bg-[color:var(--bc-carbon)] p-5 ring-1 ring-[color:var(--bc-rule)] transition-[box-shadow] duration-300 hover:ring-white/30 md:p-7 ${dir === 'Next round' ? 'md:flex-row-reverse md:text-right' : ''}`}>
                      <span aria-hidden className="bc-glare" />
                      <span aria-hidden className="flex h-16 w-20 shrink-0 items-center justify-center text-white/60 transition-colors group-hover:text-white">
                        {showOutline(r) ? <CircuitSvg circuitId={r.circuitId} className="h-full w-full" strokeWidth={2} startMarker={false} /> : <span className="text-[1.5rem]">{dir === 'Next round' ? '→' : '←'}</span>}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="bc-label block text-[color:var(--bc-titanium)]">{dir} · Round {r.round}</span>
                        <span className="bc-wide mt-2 block text-[1.15rem] leading-tight text-white [overflow-wrap:anywhere]">{r.name}</span>
                        <span className="mt-1 block text-[0.88rem] text-[color:var(--bc-silver)]">{r.circuitName}</span>
                      </span>
                    </Link>
                  ) : <div key={dir} className="hidden md:block" />,
                )}
              </div>
              <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
                <Link href={`/schedule/${race.season}`} className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">{race.season} calendar <span aria-hidden>→</span></Link>
                <Link href={`/results/${race.season}/drivers`} className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">{race.season} standings <span aria-hidden>→</span></Link>
              </div>
            </div>
          </nav>
        )}
      </article>
    </SessionClockProvider>
  );
}

/** Lap length by year: each Grand Prix layout the circuit has used, on one year axis, this season's lit. */
function LapLengthByYear({ eras, season, lapKm }: { eras: LayoutEra[] | null; season: number; lapKm: number | null }) {
  if (!eras || eras.length < 2) return null;
  const nowYear = Math.max(season, new Date().getUTCFullYear());
  const first = Math.min(...eras.map((e) => e.from));
  const span = Math.max(1, nowYear + 1 - first);
  const list = eras.slice(0, 8);
  return (
    <div className="mt-6 rounded-[18px] bg-[color:var(--bc-night)] p-5 ring-1 ring-[color:var(--bc-rule)] md:p-6">
      <p className="bc-label text-[color:var(--bc-titanium)]">Lap length by year</p>
      <ol className="mt-4 space-y-3">
        {list.map((e) => {
          const current = season >= e.from && (e.to === null || season <= e.to) && (lapKm == null || lapKm === e.lengthKm);
          const left = ((e.from - first) / span) * 100;
          const width = Math.max(1.5, (((e.to ?? nowYear) + 1 - e.from) / span) * 100);
          return (
            <li key={`${e.from}-${e.to}-${e.lengthKm}`}>
              <span className="flex items-baseline justify-between gap-3 text-[0.88rem]">
                <span className={current ? 'text-white' : 'text-[color:var(--bc-silver)]'}>{e.to === e.from ? e.from : `${e.from}–${e.to ?? 'today'}`}{current ? <span className="bc-label ml-2 text-[0.6rem] text-[color:var(--bc-red-text)]">{season}</span> : null}</span>
                <span className={`bc-mono ${current ? 'text-white' : 'text-[color:var(--bc-silver)]'}`}>{e.lengthKm} km</span>
              </span>
              <span aria-hidden className="relative mt-1.5 block h-[3px] rounded-full bg-white/[0.08]">
                <span className={`absolute inset-y-0 rounded-full ${current ? 'bg-[color:var(--bc-red)]' : 'bg-white/45'}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
      {eras.length > list.length && <p className="mt-3 text-[0.875rem] text-[color:var(--bc-titanium)]">{eras.length - list.length} earlier layouts not shown.</p>}
    </div>
  );
}

/** src + srcSet for a Commons photo, so phones take a small rendition. */
function photoRendition(src: string, width?: number | null): { src: string; srcSet?: string } {
  const r = bestRendition(src, { intrinsicWidth: width ?? undefined });
  return r.srcSet ? { src: r.src, srcSet: r.srcSet } : { src: r.src };
}
