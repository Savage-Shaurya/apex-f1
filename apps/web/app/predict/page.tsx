import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { jolpica, mapRace, mapDriver } from '@apex/api-client/jolpica';
import {
  getConsensus,
  getLeaderboard,
  getPrediction,
  predictionCookieSecret,
  readPredictionIdentity,
  PREDICTION_COOKIE,
} from '@apex/db';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import { AutoRefresh, Countdown } from '@/components/brand-c/live';
import { ArrowLink, Grid, Icon, Label, Section, SourceNote, Text, Unavailable } from '@/components/ds';
import { Eyebrow, SectionTitle, fitDisplay } from '@/components/info/carbon';
import { CircuitSvg } from '@/components/circuit/CircuitSvg';
import { PickBoard } from '@/components/predict/PickBoard';
import type { PickDriver } from '@/components/predict/DriverSheet';
import { PREDICT_QUESTIONS, PREDICT_MAX, scorePicks } from '@/lib/predict';
import { getCalendar, getGrid } from '@/lib/grid';
import { getActiveSeason } from '@/lib/season';
import { loadSheet } from '@/components/live/sheet';
import { withSocial } from '@/lib/page-metadata';

export const revalidate = 600;

export const metadata: Metadata = withSocial({
  title: 'Grid Predict: call pole, the winner, a podium and fastest lap',
  description: `Apex Grid Predict: four calls on the real grid before qualifying, worth ${PREDICT_MAX} points, scored against the official result and ranked on a season leaderboard. Free, no account.`,
  alternates: { canonical: '/predict' },
});

const UTC_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export default async function PredictPage() {
  let races: ReturnType<typeof mapRace>[] = [];
  let entries: ReturnType<typeof mapDriver>[] = [];
  let dataUnavailable = false;
  try {
    const [schedule, list] = await Promise.all([
      jolpica.getSchedule('current', { revalidate: 3600, strict: true }),
      jolpica.getDrivers('current', { revalidate: 1800, strict: true }),
    ]);
    races = schedule.map(mapRace);
    entries = list.map(mapDriver);
  } catch { dataUnavailable = true; }
  // Request time from the per-request calendar read (shared with the shell; no extra provider call).
  const { now } = await getCalendar();
  const next = races.find((r) => new Date(r.raceStartIso).getTime() > now);
  const lastDone = [...races].reverse().find((r) => new Date(r.raceStartIso).getTime() < now);
  const season = next?.season ?? lastDone?.season ?? (await getActiveSeason().catch(() => null));
  const driverName = new Map(entries.map((d) => [d.slug, d.fullName] as const));

  let pid: string | null = null;
  let identityReady = false;
  try {
    const secret = predictionCookieSecret();
    identityReady = Boolean(process.env.DATABASE_URL) && !dataUnavailable && entries.length > 0;
    pid = readPredictionIdentity((await cookies()).get(PREDICTION_COOKIE)?.value, secret);
  } catch { /* Unsigned identities are never accepted; the board shows as not saving. */ }

  let lockMs = 0;
  let initialPicks: Record<string, string> = {};
  let initialRevision: string | null = null;
  let consensus: Awaited<ReturnType<typeof getConsensus>> = { total: 0, questions: {} };
  if (next && season) {
    const qualifying = next.sessions.find((s) => s.kind === 'Q');
    lockMs = qualifying && /T\d{2}:\d{2}/.test(qualifying.iso) ? new Date(qualifying.iso).getTime() : 0;
    if (!Number.isFinite(lockMs) || lockMs <= 0) lockMs = 0;
    try {
      const [mine, c] = await Promise.all([pid ? getPrediction(pid, season, next.round) : Promise.resolve(null), getConsensus(season, next.round)]);
      initialPicks = (mine?.picks ?? {}) as Record<string, string>;
      initialRevision = mine?.revision ?? null;
      consensus = c;
    } catch { identityReady = false; }
  }

  // Public rendering only reads grades; the background scoring job writes them.
  let last: {
    name: string;
    href: string;
    winner: string;
    leaderboard: Awaited<ReturnType<typeof getLeaderboard>>;
    leaderboardUnavailable: boolean;
    score: ReturnType<typeof scorePicks> | null;
    /** The race just run, when its official result is not published yet. */
    pending: string | null;
  } | null = null;
  // The drivers who started the latest race: the real line-up, without reserve and practice-only drivers.
  let lineup: Set<string> | null = null;
  // The latest race with a published result; the one just run may not have its classification yet.
  const started = races.filter((r) => new Date(r.raceStartIso).getTime() < now).reverse().slice(0, 2);
  let pending: string | null = null;
  for (const done of started) {
    const [rr, quali] = await Promise.all([
      jolpica.getRaceResults(done.season, done.round, { revalidate: 3600, strict: true }),
      jolpica.getQualifying(done.season, done.round, { revalidate: 3600, strict: true }),
    ]).catch(() => [null, []] as const);
    if (!rr || rr.results.length === 0) {
      if (done === started[0]) pending = done.name;
      continue;
    }
    if (rr.results.length >= 10) lineup = new Set(rr.results.map((r) => r.Driver.driverId));
    const grades = await Promise.all([getLeaderboard(done.season, 10), pid ? getPrediction(pid, done.season, done.round) : Promise.resolve(null)])
      .then(([leaderboard, mine]) => ({ leaderboard, mine, unavailable: !process.env.DATABASE_URL }))
      .catch(() => ({ leaderboard: [] as Awaited<ReturnType<typeof getLeaderboard>>, mine: null, unavailable: true }));
    const winnerId = rr.results.find((r) => r.position === '1')?.Driver.driverId ?? '';
    const checked = grades.mine?.score !== null && grades.mine?.picks ? scorePicks(grades.mine.picks, rr.results, quali) : null;
    last = {
      name: done.name,
      href: `/schedule/${done.season}/${done.routeSlug ?? done.slug}`,
      winner: driverName.get(winnerId) ?? winnerId,
      leaderboard: grades.leaderboard,
      leaderboardUnavailable: grades.unavailable,
      score: checked && checked.total === grades.mine?.score ? checked : null,
      pending,
    };
    break;
  }

  // Display enrichment only; the prediction contract carries driver ids.
  // Team names come from the latest timed session (OpenF1), the same names the /live sheets print.
  const [grid, sheet] = await Promise.all([getGrid().catch(() => []), loadSheet(undefined).catch(() => null)]);
  const timedTeam = new Map(sheet?.state === 'ready' ? [...sheet.drivers.values()].map((d) => [`${d.code}|${d.number}` as string, d.team] as const) : []);
  const gridBySlug = new Map(grid.map((g) => [g.slug, g] as const));
  const pickers: PickDriver[] = entries
    .filter((d) => (lineup ? lineup.has(d.slug) : grid.length ? gridBySlug.has(d.slug) : true))
    .map((d) => {
      const g = gridBySlug.get(d.slug);
      return {
        id: d.slug,
        name: d.fullName,
        firstName: g?.firstName ?? d.fullName.split(' ').slice(0, -1).join(' '),
        lastName: g?.lastName ?? d.fullName.split(' ').at(-1) ?? d.fullName,
        team: (g && timedTeam.get(`${g.code}|${g.number}`)) ?? g?.team ?? null,
        color: g?.color ?? null,
        number: g?.number ?? null,
        code: g?.code ?? null,
        headshot: g?.headshot ?? null,
        portrait: g?.portrait ?? null,
      };
    })
    .sort((a, b) => (a.team ?? '~').localeCompare(b.team ?? '~') || a.lastName.localeCompare(b.lastName));

  const lockLabel = lockMs > 0 ? `${UTC_LONG.format(new Date(lockMs))} UTC` : null;
  const lockedNow = lockMs > 0 && now >= lockMs;

  return (
    <article className="bc bcp relative overflow-x-clip [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28 [&_select]:scroll-mt-28">
      <AutoRefresh everyMs={300_000} watch={lockMs > now ? [new Date(lockMs).toISOString()] : []} />
      <section aria-labelledby="predict-title" className="relative isolate">
        <div aria-hidden className="bcp-flood pointer-events-none absolute inset-0 -z-10" />
        <div className="ds-container pb-16 pt-14 md:pb-24 md:pt-24">
          <div className="grid items-end gap-x-10 gap-y-12 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <Eyebrow className="bc-in-up">The Apex game{season ? ` · ${season} season` : ''}</Eyebrow>
              <h1 id="predict-title" className="mt-5 text-white">
                <span className="bc-mask bcp-fit" style={fitDisplay('Grid Predict', { max: 8, lg: 0.56 })}><span className="bc-display bc-in-rise" style={{ '--d': '60ms' } as CSSProperties}>Grid Predict</span></span>
              </h1>
              <p className="bc-serif bc-in-up mt-7 max-w-[30ch] text-pretty text-[clamp(1.5rem,1.1rem+1.5vw,2.4rem)] leading-[1.2] text-white" style={{ '--d': '180ms' } as CSSProperties}>
                Four calls on the real grid before qualifying starts, scored against the official result.
              </p>
              <dl className="bc-in-up mt-10 grid max-w-[38rem] grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-[color:var(--bc-rule)] ring-1 ring-[color:var(--bc-rule)] sm:grid-cols-4" style={{ '--d': '260ms' } as CSSProperties}>
                {PREDICT_QUESTIONS.map((q) => (
                  <div key={q.id} className="min-w-0 bg-[#0b0b0d] px-4 py-4">
                    <dt className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">{q.id === 'podium' ? 'Podium' : q.id === 'fastest_lap' ? 'Fastest lap' : q.id === 'pole' ? 'Pole' : 'Winner'}</dt>
                    <dd className="mt-2 flex items-baseline gap-1.5"><span className="bc-mono text-[1.9rem] leading-none text-white">{q.points}</span><span className="bc-label text-[0.62rem] text-[color:var(--bc-titanium)]">pts</span></dd>
                  </div>
                ))}
              </dl>
            </div>

            {next ? (
              <section aria-label="Next race" className="bc-in-up min-w-0 lg:col-span-5" style={{ '--d': '200ms' } as CSSProperties}>
                <div className="bcp-panel overflow-hidden p-6 md:p-8">
                  <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.10),transparent)]" />
                  <div className="relative flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-6 bg-[color:var(--bc-red)]" />Round {next.round} · next race</p>
                      <p className="bc-wide mt-4 text-[clamp(1.35rem,1.05rem+1.2vw,2.1rem)] leading-[1.05] text-white [overflow-wrap:anywhere]">{next.name}</p>
                      <p className="mt-2 text-[0.95rem] text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">{next.circuitName}, {next.city}</p>
                    </div>
                    <CircuitSvg circuitId={next.circuitId} className="h-auto w-24 shrink-0 text-white/80 drop-shadow-[0_0_10px_rgb(233_240_255/0.35)] sm:w-32" strokeWidth={2} title={`${next.circuitName} layout`} />
                  </div>
                  <div className="relative mt-8 border-t border-[color:var(--bc-rule)] pt-6">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <p className="bc-label text-white">{lockedNow ? 'Picks locked at qualifying' : 'Picks lock when qualifying starts'}</p>
                      <p className={lockedNow ? 'bc-label rounded-full px-3 py-1.5 text-[0.66rem] text-[color:var(--bc-silver)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]' : 'bc-label rounded-full bg-[color:var(--bc-red)] px-3 py-1.5 text-[0.66rem] text-white'}>
                        {lockedNow ? 'Picks locked' : 'Picks open'}
                      </p>
                    </div>
                    <p className="bc-mono mt-2 text-[0.82rem] text-[color:var(--bc-titanium)]">{lockLabel ?? 'Qualifying time to be confirmed.'}</p>
                    {lockMs > now && (
                      <div className="mt-5"><Countdown iso={new Date(lockMs).toISOString()} size="l" className="text-[clamp(1.9rem,1.2rem+2.4vw,3rem)]" /></div>
                    )}
                  </div>
                  <Link href={`/schedule/${next.season}/${next.routeSlug ?? next.slug}`} className="relative mt-7 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)] transition-colors hover:bg-white/10">
                    Race weekend <span aria-hidden>→</span>
                  </Link>
                </div>
              </section>
            ) : null}
          </div>
        </div>
        <div aria-hidden className="bcp-horizon" />
      </section>

      <Section spacing="tight" aria-label="Your picks" className="pb-24 pt-16 md:pb-32 md:pt-20">
        {next && season ? (
          <PickBoard
            key={`${season}-${next.round}`}
            raceName={next.name}
            raceSlug={next.slug}
            season={season}
            round={next.round}
            isAvailable={identityReady}
            unavailableReason={process.env.DATABASE_URL ? 'service' : 'database'}
            checkedAt={now}
            lockTimestamp={lockMs || undefined}
            lockLabel={lockLabel}
            drivers={pickers}
            initialPicks={initialPicks}
            initialRevision={initialRevision}
          />
        ) : (
          <Unavailable
            title={dataUnavailable ? 'Calendar unavailable' : 'No race left to predict this season'}
            action={{ label: 'Race calendar', href: '/schedule' }}
          >
            {dataUnavailable
              ? 'The race calendar can’t be shown right now, so picks can’t open yet. Please check back in a few minutes.'
              : 'The game opens again when next season’s calendar is published. Last race results and the season leaderboard are below.'}
          </Unavailable>
        )}
      </Section>

      {consensus.total > 0 && (
        <Section spacing="default" aria-labelledby="consensus-title" className="bc-carbon border-y border-[color:var(--bc-rule)]">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <SectionTitle id="consensus-title" eyebrow="Everyone’s calls" title="The grid thinks" />
            <p className="bc-label text-[color:var(--bc-titanium)]">{consensus.total} {consensus.total === 1 ? 'player has' : 'players have'} picked</p>
          </div>
          <div className="mt-10 grid gap-x-10 gap-y-12 md:grid-cols-2 xl:grid-cols-4">
            {PREDICT_QUESTIONS.map((q) => {
              const rows = (consensus.questions[q.id] ?? []).slice(0, 3);
              return (
                <div key={q.id} className="min-w-0">
                  <Label as="h3" size="l" tone="default">{q.label}</Label>
                  {rows.length ? (
                    <ol className="mt-5 grid gap-4">
                      {rows.map((r) => (
                        <li key={r.value}>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 font-text text-ui text-fg [overflow-wrap:anywhere]">{driverName.get(r.value) ?? r.value}</span>
                            <span className="shrink-0 font-text text-ui font-[650] tabular-nums text-fg">{r.pct}%</span>
                          </div>
                          <span aria-hidden className="mt-2 block h-1.5 bg-[var(--rule)]">
                            <span className="block h-full" style={{ width: `${Math.max(2, r.pct)}%`, backgroundColor: gridBySlug.get(r.value)?.color ?? 'var(--fg-2)' }} />
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="mt-5 font-text text-small text-fg-3">No picks yet.</p>}
                </div>
              );
            })}
          </div>
          <SourceNote className="mt-10" updated="Shares of saved picks for this race" />
        </Section>
      )}

      {last && (
        <Section spacing="default" aria-labelledby="last-title" className="border-t border-[color:var(--bc-rule)]">
          <Grid className="gap-y-12">
            <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-5">
              <Eyebrow>{last.pending ? 'Latest result' : 'Last race'}</Eyebrow>
              <h2 id="last-title" className="bc-wide mt-4 text-[clamp(1.3rem,1rem+1.2vw,2rem)] leading-[1.1] text-white">{last.name}</h2>
              <p className="bc-label mt-8 text-[color:var(--bc-titanium)]">Winner</p>
              <p className="bc-display mt-3 text-[clamp(2rem,1.2rem+3vw,3.6rem)] text-white [overflow-wrap:anywhere]">{last.winner}</p>
              <ArrowLink href={last.href} className="mt-4">Full result</ArrowLink>
              {last.pending && (
                <p className="mt-4 max-w-[44ch] font-text text-small text-fg-2">
                  The official result of the {last.pending} is not confirmed yet. Picks for it are scored once it is.
                </p>
              )}

              {last.score && (
                <div className="bcp-panel mt-10 p-6">
                  <div className="flex items-end justify-between gap-4 pb-4 shadow-[inset_0_-1px_0_var(--rule)]">
                    <Label as="p" tone="default">Your score</Label>
                    <p className="flex items-baseline gap-1.5">
                      <span className="font-display font-normal-width text-stat-l leading-none">{last.score.total}</span>
                      <span className="font-text text-ui text-fg-2">/ {PREDICT_MAX} pts</span>
                    </p>
                  </div>
                  <ul>
                    {last.score.questions.map((q) => (
                      <li key={q.id} className="flex items-center justify-between gap-4 py-3 shadow-[inset_0_-1px_0_var(--rule)] last:shadow-none">
                        <span className="font-text text-small text-fg-2">{q.label}</span>
                        <span className="flex items-center gap-2 text-right font-text text-small text-fg">
                          {q.pick ? (driverName.get(q.pick) ?? q.pick) : 'No pick'}
                          <Icon name={q.correct ? 'check' : 'close'} size={16} label={q.correct ? `correct, ${q.awarded} points` : 'not correct'} className={q.correct ? 'text-sector-green' : 'text-fg-3'} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-6 lg:col-start-7">
              <h3 className="bc-wide text-[clamp(1.2rem,1rem+0.8vw,1.6rem)] text-white">Season leaderboard</h3>
              {last.leaderboard.length > 0 ? (
                <table className="mt-5 w-full border-collapse font-text text-ui tabular-nums">
                  <caption className="sr-only">Season leaderboard, top 10 players by points</caption>
                  <thead>
                    <tr className="border-b border-rule-strong">
                      <th scope="col" className="w-12 pb-2.5 text-left text-label font-[650] uppercase text-fg-3">Pos</th>
                      <th scope="col" className="pb-2.5 text-left text-label font-[650] uppercase text-fg-3">Player</th>
                      <th scope="col" className="hidden pb-2.5 text-right text-label font-[650] uppercase text-fg-3 sm:table-cell">Races</th>
                      <th scope="col" className="pb-2.5 text-right text-label font-[650] uppercase text-fg-3">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {last.leaderboard.map((row, i) => (
                      <tr key={row.clientId} className="border-b border-rule">
                        <td className="bc-wide py-3.5 text-[1.2rem] leading-none text-white">{i + 1}</td>
                        <th scope="row" className="py-3.5 text-left font-[650] [overflow-wrap:anywhere]">{`Anonymous player ${row.clientId.slice(0, 4)}`}</th>
                        <td className="hidden py-3.5 text-right text-fg-2 sm:table-cell">{row.races}</td>
                        <td className="py-3.5 text-right font-[650]">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Unavailable compact className="mt-5" title={last.leaderboardUnavailable ? 'Leaderboard unavailable' : 'No scored picks yet'}>
                  {last.leaderboardUnavailable
                    ? process.env.DATABASE_URL ? 'The leaderboard can’t be shown right now. Please check back in a few minutes.' : 'The leaderboard is not available yet.'
                    : 'Scores appear here once the first race with saved picks has an official result.'}
                </Unavailable>
              )}
            </div>
          </Grid>
        </Section>
      )}

      <Section spacing="default" aria-labelledby="rules-title" className="bc-carbon border-t border-[color:var(--bc-rule)]">
        <div className="max-w-[var(--measure)]">
          <SectionTitle id="rules-title" size="s" eyebrow="The rules" title="How it works" />
          <Text className="mt-6">
            Make up to four calls for the next race: pole position (3 points), the race winner (5), one driver who finishes on the podium
            (3) and the fastest lap (2). You can change them as often as you like until qualifying starts; then they lock.
          </Text>
          <Text className="mt-4">
            Picks are scored once the official classification is confirmed. Points add up across the season on the leaderboard.
          </Text>
          <Text className="mt-4" tone="muted">
            There is no account. Your picks are saved with Apex and linked to this browser, so clearing cookies or switching
            browsers starts a new player.
          </Text>
        </div>
      </Section>
    </article>
  );
}
