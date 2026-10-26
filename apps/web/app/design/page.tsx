import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { colors } from '@apex/ui/tokens';
import { getCalendar, getConstructorStandings, getGrid, getStandingsSeason } from '@/lib/grid';
import { getHomeFeed } from '@/lib/home-feed';
import { decodeEntities, shortRaceName, teamColorBySlug } from '@/lib/format';
import { getCircuit } from '@/lib/circuits';
import {
  ArrowLink, ButtonLink, Card, Container, CountdownClock, EmptyState, FlagBadge, Grid, Heading, Headshot, Icon, ICON_NAMES, Label, Marquee,
  Media, Numeral, Section, SectorMark, Skeleton, SkeletonText, SourceNote, LightLoader, Stat, StatGroup, StatusBadge, StoryCard, Tag,
  TeamMark, Text, TextLink, Timing, ToneBox, TyreBadge, Unavailable, Breadcrumbs, TabLinks, contrastRatio, type Tone,
} from '@/components/ds';
import { SiteHeader, SiteFooter, ConsentBanner } from '@/components/ds/shell';
import { getSeasonContext } from '@/lib/season';
import { BRAND_STATEMENT } from '@/lib/credits';
import { CircuitStage, FormDemo, RevealDemo, RollingDemo, StandingsTabs, type DemoStanding } from './DesignDemos';

export const metadata: Metadata = { title: 'Design system', robots: { index: false, follow: false } };

const settle = <T,>(p: Promise<T>, name = 'read') => p.then((value) => ({ ok: true as const, value })).catch((error: unknown) => { console.warn(`[design] ${name} unavailable:`, error instanceof Error ? error.message : error); return { ok: false as const }; });
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/**
 * Colour swatch. `text` swatches show their worst case: the ratio on the
 * highest surface they may sit on (`worst`), labelled by what that allows.
 * `marks` swatches are never labelled as text, whatever the ratio.
 */
function Swatch({ name, hex, on = colors.ground, worst, text = false, marks = false }: { name: string; hex: string; on?: string; worst?: { hex: string; name: string }; text?: boolean; marks?: boolean }) {
  const ratio = contrastRatio(hex, worst?.hex ?? on);
  const verdict = marks ? (ratio >= 3 ? ' marks only, never text' : ' not perceivable') : text ? (ratio >= 4.5 ? ' AA text' : ratio >= 3 ? ' large text and marks only' : ' not for text') : '';
  return (
    <div className="min-w-0">
      <div className="ds-media-outline relative h-16" style={{ backgroundColor: hex }} />
      <p className="mt-2 font-text text-small font-[650] text-fg">{name}</p>
      <p className="font-text text-caption text-fg-3 tabular-nums">
        {hex} · {ratio.toFixed(2)}:1{worst ? ` on ${worst.name}` : ''}{verdict}
      </p>
    </div>
  );
}

function SpecimenRow({ token, spec, children }: { token: string; spec: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 py-6 shadow-[inset_0_-1px_0_var(--rule)] md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
      <div>
        <p className="font-text text-small font-[650] text-fg">{token}</p>
        <p className="font-text text-caption text-fg-3">{spec}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default async function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const [calendarR, gridR, feedR, teamsR, seasonR, contextR] = await Promise.all([
    settle(getCalendar(), 'calendar'), settle(getGrid(), 'grid'), settle(getHomeFeed(), 'feed'), settle(getConstructorStandings(), 'constructors'), settle(getStandingsSeason(), 'season'), settle(getSeasonContext(), 'season context'),
  ]);
  const calendar = calendarR.ok && calendarR.value.state === 'available' ? calendarR.value : null;
  const next = calendar?.next ?? null;
  const grid = gridR.ok ? gridR.value : [];
  const feed = feedR.ok ? feedR.value.filter((i) => i.title) : [];
  const teams = teamsR.ok ? teamsR.value : [];
  const season = seasonR.ok ? seasonR.value.season : null;
  // Seasons come from lib/season.ts, never the clock year.
  const navSeasons = contextR.ok ? { calendar: contextR.value.calendarSeason, results: contextR.value.resultsSeasonConfirmed ? contextR.value.resultsSeason : null } : null;
  const leader = grid[0] ?? null;
  const longest = [...grid].sort((a, b) => `${b.firstName} ${b.lastName}`.length - `${a.firstName} ${a.lastName}`.length)[0] ?? null;
  const withImages = feed.filter((i) => i.imageUrl);
  const circuit = next && getCircuit(next.circuitId) ? next.circuitId : null;

  const drivers: DemoStanding[] = grid.slice(0, 10).map((d) => ({ position: d.position, name: `${d.firstName} ${d.lastName}`, team: d.team, color: d.color, points: d.points, wins: d.wins }));
  const constructors: DemoStanding[] = teams.slice(0, 11).map((t) => ({ position: t.position, name: t.constructor.name, team: t.constructor.name, color: teamColorBySlug(t.constructor.id), points: t.points, wins: t.wins }));
  const navRace = next ? { round: next.round, name: shortRaceName(next.name), country: next.country, href: `/schedule/${next.season}/${next.routeSlug ?? next.slug}`, startIso: next.raceStartIso } : null;
  const navLead = feed[0] ? { title: decodeEntities(feed[0].title), source: feed[0].source, href: feed[0].link } : null;

  const tones: Tone[] = ['carbon', 'raised', 'paper', 'red'];

  return (
    <div className="pb-0">
      <div className="sticky top-[var(--nav-offset)] z-40">
        {navSeasons ? <SiteHeader facts={{ seasons: navSeasons, nextRace: navRace, lead: navLead }} position="static" /> : <Unavailable compact title="Header preview unavailable">The season could not be read, so the header links cannot be built.</Unavailable>}
      </div>

      {/* Masthead */}
      <Section spacing="tight" className="pt-16 md:pt-24">
        <Breadcrumbs items={[{ label: 'Apex', href: '/' }, { label: 'Design system' }]} />
        <Heading level={1} size="display-xl" className="mt-6 max-w-[14ch]">Programme and timing sheet</Heading>
        <Text size="lead" editorial measure className="mt-6">
          A Grand Prix prints two things: the race programme, glossy and photographic, and the timing sheet, exact to the thousandth. Apex is both. Red is the start light, and it only comes on for what is live, next, selected or the one action.
        </Text>
        <Text size="small" tone="subtle" className="mt-4">Development preview. Every value below comes from the live providers through the shared cache; this route returns 404 in production.</Text>
      </Section>

      {/* Colour */}
      <Section spacing="tight" aria-labelledby="colour">
        <Heading level={2} id="colour" size="display-m">Colour</Heading>
        <Text tone="muted" measure className="mt-3">Carbon steps make depth without lines. Paper is the timing sheet. Surface red carries white text; readable reds are separate tokens. Ink ratios are the worst case, measured on surface 4 (the highest step text may sit on).</Text>
        <Grid className="mt-8 gap-y-8">
          {([
            ['ground', colors.ground], ['surface 1', colors.surface1], ['surface 2', colors.surface2], ['surface 3', colors.surface3], ['surface 4', colors.surface4], ['deep', colors.groundDeep],
          ] as const).map(([n, h]) => <div key={n} className="col-span-2"><Swatch name={n} hex={h} on={colors.ink} /></div>)}
          {([
            ['ink', colors.ink, false], ['ink 2', colors.ink2, false], ['ink 3 (min text)', colors.ink3, false], ['ink faint', colors.inkFaint, true], ['red ink', colors.redInk, false], ['brand red (surfaces)', colors.brandRed, true],
          ] as const).map(([n, h, m]) => <div key={n} className="col-span-2"><Swatch name={n} hex={h} text={!m} marks={m} worst={{ hex: colors.surface4, name: 'surface 4' }} /></div>)}
        </Grid>
        <Grid className="mt-10 gap-y-8">
          {([
            ['sector purple', colors.sectorPurple], ['sector green', colors.sectorGreen], ['sector yellow', colors.sectorYellow], ['tyre soft', colors.tyreSoft], ['tyre medium', colors.tyreMedium], ['tyre hard', colors.tyreHard],
            ['tyre inter', colors.tyreInter], ['tyre wet', colors.tyreWet], ['safety car', colors.flagSafetyCar], ['positive', colors.positive], ['negative', colors.negative], ['info', colors.info],
          ] as const).map(([n, h]) => <div key={n} className="col-span-2"><Swatch name={n} hex={h} text /></div>)}
        </Grid>
        <ToneBox tone="paper" className="mt-10 p-6">
          <Grid className="gap-y-8">
            {([
              ['paper', colors.paper], ['paper 2', colors.paper2], ['paper 3', colors.paper3], ['paper ink 2', colors.paperInk2], ['paper ink 3', colors.paperInk3], ['red ink paper', colors.redInkPaper],
            ] as const).map(([n, h]) => <div key={n} className="col-span-2"><Swatch name={n} hex={h} on={colors.paper} text={n.includes('ink')} /></div>)}
          </Grid>
        </ToneBox>
        {grid.length > 0 && (
          <div className="mt-10">
            <Label>Team colours are data (from the live grid)</Label>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
              {[...new Map(grid.map((d) => [d.team, d.color])).entries()].map(([team, color]) => (
                <li key={team}><TeamMark color={color} name={team} className="font-text text-small text-fg" /></li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Type */}
      <Section spacing="tight" aria-labelledby="type">
        <Heading level={2} id="type" size="display-m">Type</Heading>
        <Text tone="muted" measure className="mt-3">Anybody for display, Hanken Grotesk for reading and data, EB Garamond for the editorial voice, JetBrains Mono for timing values only. Tracking is built into every step: no step is negative, display capitals open slightly, and only sentence-case display above 48px closes (by at most -0.008em).</Text>
        <div className="mt-8">
          <SpecimenRow token="display-xl" spec="Anybody 800 · 36-160px · lh 0.92 · caps 0em · sentence -0.008em from 768px">
            <Heading level={3} as="p" size="display-xl">{next ? shortRaceName(next.name) : 'Grand Prix'}</Heading>
          </SpecimenRow>
          <SpecimenRow token="display-l" spec="Anybody 800 · 32-104px · lh 0.95 · caps +0.003em">
            <Heading level={3} as="p" size="display-l">{leader ? leader.lastName : 'Podium'}</Heading>
          </SpecimenRow>
          <SpecimenRow token="display-m" spec="Anybody 800 · 28-64px · lh 1.0 · caps +0.005em">
            <Heading level={3} as="p" size="display-m">{longest ? `${longest.firstName} ${longest.lastName}` : 'Constructors'}</Heading>
          </SpecimenRow>
          <SpecimenRow token="display-l, sentence case" spec="Long titles (over 32 characters) · -0.008em from 1024px only">
            <Heading level={3} as="p" size="display-l" caps={false}>{feed[0] ? decodeEntities(feed[0].title) : 'Story title'}</Heading>
          </SpecimenRow>
          <SpecimenRow token="heading-l" spec="Hanken 700 · 26-40px · 0em">
            <p className="font-text text-heading-l text-fg">{next ? `${next.circuitName}, ${next.city}` : 'Circuit'}</p>
          </SpecimenRow>
          <SpecimenRow token="heading-m" spec="Hanken 700 · 21-28px · 0em">
            <p className="font-text text-heading-m text-fg">{feed[0] ? decodeEntities(feed[0].title) : 'Story title'}</p>
          </SpecimenRow>
          <SpecimenRow token="heading-s" spec="Hanken 650 · 18-21px · +0.004em">
            <p className="font-text text-heading-s text-fg">{feed[1] ? decodeEntities(feed[1].title) : 'Card title'}</p>
          </SpecimenRow>
          <SpecimenRow token="lead (editorial)" spec="EB Garamond 400 · 19-24px · lh 1.42">
            <p className="ds-editorial font-editorial text-lead text-fg">{feed[0]?.description ? decodeEntities(feed[0].description).slice(0, 220) : 'Standfirst text.'} <em>Italic for titles of works.</em></p>
          </SpecimenRow>
          <SpecimenRow token="body" spec="Hanken 400 · 16-18px · lh 1.62 · +0.01em">
            <p className="max-w-[var(--measure)] font-text text-body text-fg">
              {feed[2]?.description ? decodeEntities(feed[2].description) : 'Body text.'} Names with Latin Extended letters render in the brand face: Kubica, Räikkönen, Hülkenberg, Pérez, Łódź, İstanbul Park, Brno, Ştefan, Győr. <em>Real italic for emphasis.</em>
            </p>
          </SpecimenRow>
          <SpecimenRow token="ui / small / caption" spec="Hanken · 15 / 14 / 13px · +0.012 / +0.016 / +0.02em">
            <p className="font-text text-ui text-fg">UI label {leader ? `${leader.firstName} ${leader.lastName}` : ''}</p>
            <p className="font-text text-small text-fg-2">Small: {next ? `${next.city}, ${next.country}` : 'secondary text'}</p>
            <p className="font-text text-caption text-fg-3">Caption: source and time notes</p>
          </SpecimenRow>
          <SpecimenRow token="label" spec="Hanken 650 caps · 12-13px · +0.1 / +0.08em">
            <Label>Driver standings</Label>{' '}<Label size="l" tone="default" className="ml-4">Round {next?.round ?? ''}</Label>
          </SpecimenRow>
          <SpecimenRow token="numbers" spec="Anybody tabular · Hanken tabular · JetBrains for timing">
            <div className="flex flex-wrap items-baseline gap-8">
              <Numeral value={leader?.points ?? '--'} unit="pts" size="stat-xl" />
              <Numeral value={leader?.wins ?? '--'} unit="wins" size="stat-l" />
              <Numeral value={grid.length || '--'} unit="drivers" size="stat-m" />
              {next && <Timing>{new Date(next.raceStartIso).toISOString().slice(11, 19)} UTC</Timing>}
            </div>
            <p className="mt-2 font-text text-caption text-fg-3">The timing face shows the next race start time in UTC here; in the product it carries the final lap times and gaps once a session has finished.</p>
          </SpecimenRow>
        </div>
      </Section>

      {/* Tones */}
      <Section spacing="tight" aria-labelledby="tones">
        <Heading level={2} id="tones" size="display-m">Tones</Heading>
        <Text tone="muted" measure className="mt-3">The same primitives on each field. Nothing has a dark or light variant; it reads the tone.</Text>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {tones.map((t) => (
            <ToneBox key={t} tone={t} className="flex flex-col gap-4 p-6">
              <Label>{t}</Label>
              <Heading level={3} size="heading-l" caps={false}>{next ? shortRaceName(next.name) : 'Next race'}</Heading>
              <Text size="small" tone="muted">{next ? `Round ${next.round} · ${next.circuitName}` : 'Calendar unavailable'}</Text>
              <div className="flex flex-wrap gap-2">
                <Tag>Category</Tag>
                <StatusBadge status="next" />
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <ButtonLink href="/schedule" variant={t === 'red' ? 'inverse' : 'primary'}>Schedule</ButtonLink>
                <ButtonLink href="/results/archive" variant="secondary" icon={false}>Archive</ButtonLink>
              </div>
              <TextLink href="/about">Inline link in running text</TextLink>
            </ToneBox>
          ))}
        </div>
      </Section>

      {/* Controls and marks */}
      <Section spacing="tight" aria-labelledby="controls">
        <Heading level={2} id="controls" size="display-m">Controls and marks</Heading>
        <div className="mt-8 grid gap-10 lg:grid-cols-2">
          <div className="grid gap-6">
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/schedule" size="lg" cut>Hero action</ButtonLink>
              <ButtonLink href="/latest" variant="secondary" size="lg">Secondary</ButtonLink>
              <ButtonLink href="https://www.fia.com/" external variant="ghost" size="lg">External</ButtonLink>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <ArrowLink href="/latest">All stories</ArrowLink>
              <ArrowLink href="https://www.fia.com/" external>FIA</ArrowLink>
            </div>
            <TabLinks label="Results views" items={[{ href: '/design', label: 'Drivers', current: true }, { href: '/design#teams', label: 'Constructors' }, { href: '/results/archive', label: 'Archive' }]} />
          </div>
          <div className="grid gap-6">
            <div className="flex flex-wrap gap-3">
              {(['live', 'next', 'upcoming', 'finished', 'delayed', 'cancelled', 'snapshot', 'unavailable'] as const).map((s) => <StatusBadge key={s} status={s} />)}
            </div>
            <div className="flex flex-wrap gap-4">
              {(['soft', 'medium', 'hard', 'intermediate', 'wet'] as const).map((c) => <TyreBadge key={c} compound={c} showName />)}
            </div>
            <div className="flex flex-wrap gap-4">
              {(['green', 'yellow', 'red', 'blue', 'safety-car', 'chequered'] as const).map((f) => <FlagBadge key={f} flag={f} />)}
            </div>
            <div className="flex items-center gap-4"><SectorMark kind="purple" /><SectorMark kind="green" /><SectorMark kind="yellow" /><Text as="span" size="small" tone="muted">Sector colours: fastest overall, personal best, no improvement</Text></div>
            <div className="flex flex-wrap gap-3 text-fg-2">
              {ICON_NAMES.map((n) => <Icon key={n} name={n} label={n} size={22} />)}
            </div>
            <Text size="caption" tone="subtle">The live badge is shown here as a specimen. In the product it appears only while a session is confirmed running.</Text>
          </div>
        </div>
      </Section>

      {/* Media and stories */}
      <Section spacing="tight" aria-labelledby="media">
        <Heading level={2} id="media" size="display-m">Media without cropping</Heading>
        <Text tone="muted" measure className="mt-3">Headshots and cut-outs are contained on a quiet field of the team colour. Photographs only cover their frame when the source ratio is within 20% of it; otherwise they letterbox on the tone surface. The F1 media cut-out comes first; a Wikimedia portrait is used only when it is missing and is then credited under the frame. A picture that fails or has not loaded 8 seconds after it comes into view says so instead of leaving an empty frame.</Text>
        {grid.length > 0 ? (
          <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {grid.slice(0, 6).map((d) => (
              <li key={d.slug}>
                <Headshot src={d.headshot} fallbackSrc={d.portrait} name={`${d.firstName} ${d.lastName}`} teamColor={d.color} showCredit />
                <p className="mt-2 font-text text-ui font-[650] text-fg">{d.firstName} {d.lastName}</p>
                <TeamMark color={d.color} name={d.team} className="font-text text-caption text-fg-3" />
              </li>
            ))}
          </ul>
        ) : (
          <Unavailable title="Driver photos unavailable" className="mt-8">The grid could not be loaded from the providers just now.</Unavailable>
        )}
        {withImages.length >= 4 ? (
          <div className="mt-14 grid gap-x-[var(--gutter)] gap-y-12 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <StoryCard variant="lead" href={withImages[0]!.link} external title={decodeEntities(withImages[0]!.title)} source={withImages[0]!.source} summary={withImages[0]!.description ? decodeEntities(withImages[0]!.description) : undefined} image={withImages[0]!.imageUrl} imageAlt="" meta={`${dateFmt.format(new Date(withImages[0]!.pubDateMs))} UTC`} credit={{ label: `Image: ${withImages[0]!.source}` }} />
            </div>
            <div className="grid content-start gap-8 lg:col-span-5">
              {withImages.slice(1, 4).map((s) => (
                <StoryCard key={s.link} variant="compact" href={s.link} external title={decodeEntities(s.title)} source={s.source} image={s.imageUrl} imageAlt="" meta={`${dateFmt.format(new Date(s.pubDateMs))} UTC`} />
              ))}
            </div>
            <div className="grid gap-10 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
              {withImages.slice(4, 7).map((s) => (
                <StoryCard key={s.link} href={s.link} external title={decodeEntities(s.title)} source={s.source} image={s.imageUrl} imageAlt="" meta={`${dateFmt.format(new Date(s.pubDateMs))} UTC`} />
              ))}
              {feed[7] && <StoryCard variant="text" href={feed[7].link} external title={decodeEntities(feed[7].title)} source={feed[7].source} summary={feed[7].description ? decodeEntities(feed[7].description) : undefined} meta={`${dateFmt.format(new Date(feed[7].pubDateMs))} UTC`} />}
            </div>
          </div>
        ) : (
          <Unavailable title="Headlines unavailable" className="mt-8">No stories with pictures were returned by the feeds just now.</Unavailable>
        )}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <Media src={null} alt="Missing picture" kind="photo" caption="A failed or missing picture keeps its frame." />
          {next && circuit ? <div><CircuitStage circuitId={circuit} name={next.circuitName} /><p className="mt-2.5 font-text text-small text-fg-2">{next.circuitName}: WebGL when in view, SVG fallback otherwise</p></div> : null}
          {grid[0]?.headshot ? <Media src={grid[0].headshot} alt={`${grid[0].firstName} ${grid[0].lastName}`} kind="car" accent={grid[0].color} caption="Cut-out in a wide frame: contained, never cropped" credit={{ label: 'Formula 1 media' }} /> : null}
        </div>
      </Section>

      {/* Data: the timing sheet */}
      <Section tone="paper" aria-labelledby="sheet">
        <Heading level={2} id="sheet" size="display-m">The timing sheet</Heading>
        <Text tone="muted" measure className="mt-3">Real tables, ruled like the FIA classification, tabular figures. The start stripe is always the team colour; the leader row is marked by a tone step and a red rule along its top, never by a red stripe (so it cannot be mistaken for Ferrari). The sheet stays at most 60rem wide so names and numbers sit close; the key figures take the rail beside it.</Text>
        <div className="mt-10 grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,60rem)_minmax(0,1fr)]" id="teams">
          <div className="min-w-0">
            {drivers.length ? (
              <StandingsTabs drivers={drivers} constructors={constructors} caption={season ? `${season} championship, top ten` : 'Championship'} />
            ) : (
              <Unavailable title="Standings unavailable">The standings could not be loaded just now. Nothing is shown rather than an old or invented table.</Unavailable>
            )}
            <SourceNote updated="Updated after each race" className="mt-4" />
          </div>
          {leader && (
            <StatGroup className="content-start xl:grid-cols-1 xl:pt-16">
              <Stat label="Leader" value={leader.lastName} note={leader.team} size="m" />
              <Stat label="Points" value={leader.points} unit="pts" />
              <Stat label="Wins" value={leader.wins} />
              <Stat label="Gap to second" value={grid[1] ? leader.points - grid[1].points : '--'} unit="pts" />
            </StatGroup>
          )}
        </div>
      </Section>

      {/* States */}
      <Section spacing="tight" aria-labelledby="states">
        <Heading level={2} id="states" size="display-m">States</Heading>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card><Label>Loading</Label><div className="mt-4 grid gap-4"><Skeleton className="h-8 w-2/3" /><SkeletonText lines={3} /><LightLoader message="Loading the timing tower" /></div></Card>
          <Unavailable title="Final timing not published yet" action={{ label: 'See the schedule', href: '/schedule' }}>The session has not finished. Apex shows no live timing; the final classification appears here once the session ends.</Unavailable>
          <Card><EmptyState title="No matches" action={{ label: 'Clear filters', href: '/design' }}>No stories match this filter. Try another source or clear the filters.</EmptyState></Card>
          <Unavailable compact title="Weather unavailable for this session">The forecast service did not answer.</Unavailable>
        </div>
      </Section>

      {/* Forms */}
      <Section spacing="tight" aria-labelledby="forms">
        <Heading level={2} id="forms" size="display-m">Fields and buttons</Heading>
        <div className="mt-8"><FormDemo /></div>
      </Section>

      {/* Motion */}
      <Section spacing="tight" aria-labelledby="motion">
        <Heading level={2} id="motion" size="display-m">Motion</Heading>
        <Text tone="muted" measure className="mt-3">One clock: native scrolling, read by ScrollTrigger on GSAP&apos;s ticker. A 2px red line along the header&apos;s lower edge follows how far down the page you are.</Text>
        <div className="mt-10 grid gap-14">
          {next && (
            <div>
              <Label>Countdown to {shortRaceName(next.name)} (real start time)</Label>
              <div className="mt-4"><CountdownClock targetIso={next.raceStartIso} size="xl" /></div>
            </div>
          )}
          <div>
            <Label>Rolling digits</Label>
            <div className="mt-4"><RollingDemo start={leader?.points ?? 0} /></div>
          </div>
          {leader && <RevealDemo surname={leader.lastName} caption={`Nameplate entrance on Anybody's width axis, once, then still. ${leader.firstName} ${leader.lastName} leads with ${leader.points} points.`} />}
          {feed.length > 3 && (
            <div>
              <Label>Marquee (real headlines, pauses on hover and focus)</Label>
              <Marquee label="Latest headlines" className="mt-4 py-3 shadow-[inset_0_1px_0_var(--rule),inset_0_-1px_0_var(--rule)]">
                {feed.slice(0, 8).map((s) => (
                  <a key={s.link} href={s.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-3 font-text text-ui text-fg-2 hover:text-fg">
                    <span className="size-1.5 bg-brand-red" aria-hidden />
                    <span className="font-[650] text-fg">{s.source}</span> {decodeEntities(s.title)}
                  </a>
                ))}
              </Marquee>
            </div>
          )}
        </div>
      </Section>

      {/* Shell */}
      <Section spacing="tight" aria-labelledby="shell">
        <Heading level={2} id="shell" size="display-m">Shell</Heading>
        <Text tone="muted" measure className="mt-3">The new header is pinned at the top of this page (static preview). The consent panel and footer follow; every credit lives on /references, linked from the footer.</Text>
        <div className="mt-8"><ConsentBanner preview /></div>
      </Section>
      <Container><Text size="caption" tone="subtle" className="pb-6">Footer preview</Text></Container>
      {navSeasons && <SiteFooter season={navSeasons.results} statement={BRAND_STATEMENT} preview />}
    </div>
  );
}
