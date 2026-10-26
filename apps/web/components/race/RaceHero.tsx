import '@/components/brand-c/brand-c.css';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { UiRace, UiResult } from '@apex/api-client/jolpica';
import { cn } from '@apex/ui';
import { Breadcrumbs, Media } from '@/components/ds';
import { CircuitStreak } from '@/components/brand-c/CircuitStreak';
import { AutoRefresh, Countdown, ZoneClock } from '@/components/brand-c/live';
import { PressLink } from '@/components/brand-c/Press';
import { Floodlights } from '@/components/brand-c/stages';
import { gapText, sessionEndMs, sessionName, type RaceResultsState, type WeekendSession, type weekendPhase } from './weekend';

/**
 * The race weekend's first screen, Carbon & Light: the race name lit on a
 * night stage, the real circuit outline lapped by a streak of light (or the
 * circuit's photograph when no verified outline exists), and the weekend's
 * live state from the published data: a countdown to the next session, the
 * session under way, or the podium once the race is classified. A strip of
 * weekend facts closes the hero. Entrances are CSS on first paint
 * (transform/opacity only) and rest in place under reduced motion.
 */

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

function Line({ children, delay, className, style }: { children: ReactNode; delay: number; className?: string; style?: CSSProperties }) {
  return <span className={cn('bc-mask', className)} style={style}><span className="bc-in-rise" style={d(delay)}>{children}</span></span>;
}

function TeamBar({ color }: { color: string | null }) {
  if (!color) return <span aria-hidden className="inline-block w-[3px] shrink-0" />;
  return <span aria-hidden className="inline-block h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

const UNDERLINE = 'bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 ease-[var(--bc-ease)] group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]';

/** "Fri 30 Oct · 12:30" in a zone, or null when the time is not published. */
function startLabel(iso: string, timeZone: string): string | null {
  if (!iso.includes('T')) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
    return `${day} · ${time}`;
  } catch {
    return null;
  }
}

export interface RaceHeroProps {
  race: UiRace;
  rounds: number;
  sprintWeekend: boolean;
  phase: ReturnType<typeof weekendPhase>;
  sessions: WeekendSession[];
  /** The classification, only once the race is done. */
  results: UiResult[];
  raceDone: boolean;
  /** The classification read failed (never worded as "not published yet", R3-TIME-1). */
  /** From raceResultsState (R3-TIME-1): a failed read is "unavailable", an empty read long after the race "not-published". */
  resultsState?: RaceResultsState;
  colourOf: (constructorSlug: string | undefined) => string | null;
  /** IANA zone the circuit keeps, or null. */
  zone: string | null;
  dates: { label: string; value: string };
  lapLength: string;
  /** Verified outline for this round's layout, else null. */
  outline: { d: string; width: number; height: number } | null;
  photo: { src: string; width?: number | null; height?: number | null; credit: { label: string; href?: string } } | null;
  mapNote: string;
  resultsCta: string;
}

/** Big line + small line: "MEXICO CITY" / "Grand Prix 2026"; names that do not end in "Grand Prix" stay whole. */
function titleParts(name: string): { big: string; small: string | null } {
  const m = name.match(/^(.*\S)\s+Grand Prix$/i);
  return m ? { big: m[1]!, small: 'Grand Prix' } : { big: name, small: null };
}

function WeekendState({ phase, sessions, results, raceDone, resultsState, colourOf, zone, city }: Pick<RaceHeroProps, 'phase' | 'sessions' | 'results' | 'raceDone' | 'resultsState' | 'colourOf' | 'zone'> & { city: string }) {
  if (phase === 'cancelled') {
    return (
      <div>
        <p className="bc-label text-[color:var(--bc-silver)]">Weekend status</p>
        <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">Weekend cancelled</p>
        <p className="mt-2 max-w-[44ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">Every session of this weekend was cancelled.</p>
      </div>
    );
  }
  const winner = results[0];
  if (raceDone && winner) {
    const winnerLaps = winner.laps ?? null;
    return (
      <div className="min-w-0">
        <p className="bc-label text-[color:var(--bc-silver)]">Chequered flag · Race winner</p>
        <p className="bc-wide mt-3 text-[clamp(1.3rem,2.1vw,1.8rem)] leading-[1.1]">
          <Link href={`/drivers/${winner.driver.slug}`} className="group inline-block">
            <span className={UNDERLINE}><span className="text-[color:var(--bc-silver)]">{winner.driver.firstName} </span>{winner.driver.lastName}</span>
          </Link>
        </p>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem] text-[color:var(--bc-silver)]">
          <TeamBar color={colourOf(winner.constructor?.slug)} />
          <span className="[overflow-wrap:anywhere]">{winner.constructor?.name ?? 'Constructor not published'}</span>
          {winner.time && <><span aria-hidden>·</span><span className="bc-mono text-[color:var(--bc-white)]">{winner.time}</span></>}
          {winnerLaps != null && <><span aria-hidden>·</span><span><span className="bc-mono text-[color:var(--bc-white)]">{winnerLaps}</span> laps</span></>}
        </p>
        {results.length > 1 && (
          <ol aria-label="Second and third" className="mt-5 max-w-md divide-y divide-white/10 border-y border-white/10">
            {results.slice(1, 3).map((r) => {
              const g = gapText(r, winnerLaps);
              return (
                <li key={r.driver.slug} className="flex items-center gap-3">
                  <span className="bc-wide w-8 shrink-0 text-[0.95rem] text-[color:var(--bc-silver)]">P{r.positionText}</span>
                  <TeamBar color={colourOf(r.constructor?.slug)} />
                  <Link href={`/drivers/${r.driver.slug}`} className="group flex min-h-11 min-w-0 flex-1 items-center py-1 text-[0.95rem] leading-tight">
                    <span className={cn(UNDERLINE, '[overflow-wrap:anywhere]')}><span className="text-[color:var(--bc-silver)]">{r.driver.firstName} </span><span className="font-semibold">{r.driver.lastName}</span></span>
                  </Link>
                  <span className={cn('shrink-0 text-[0.88rem] text-[color:var(--bc-silver)]', g.timing && 'bc-mono')}>{g.text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }
  const live = sessions.find((s) => s.phase === 'under-way');
  if (live) {
    return (
      <div>
        <p className="bc-label flex items-center gap-2.5 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-5 bg-[color:var(--bc-red)]" />On track now</p>
        <p className="bc-wide mt-3 text-[clamp(1.5rem,2.8vw,2.3rem)] leading-tight">{sessionName(live.kind)} under way</p>
        <p className="mt-2 max-w-[44ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">Final timing appears below after the chequered flag.</p>
      </div>
    );
  }
  const next = sessions.find((s) => s.phase === 'next');
  if (next) {
    const local = zone ? startLabel(next.iso, zone) : null;
    const utc = startLabel(next.iso, 'UTC');
    return (
      <div>
        <p className="bc-label text-[color:var(--bc-silver)]">{sessionName(next.kind)} starts in</p>
        <Countdown iso={next.iso} size="l" className="mt-3" />
        {(local || utc) && (
          <p className="mt-3 text-[0.92rem] text-[color:var(--bc-silver)]">
            {local ? `${local} ${city} time${utc ? ` · ${utc.split(' · ')[1]} UTC` : ''}` : `${utc} UTC`}
          </p>
        )}
      </div>
    );
  }
  if (raceDone && resultsState === 'unavailable') {
    return (
      <div>
        <p className="bc-label text-[color:var(--bc-silver)]">Chequered flag</p>
        <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">Results unavailable right now</p>
        <p className="mt-2 max-w-[44ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">The classification can’t be shown at the moment. Please try again in a few minutes.</p>
      </div>
    );
  }
  if (raceDone && resultsState === 'not-published') {
    return (
      <div>
        <p className="bc-label text-[color:var(--bc-silver)]">Chequered flag</p>
        <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">No classification published</p>
        <p className="mt-2 max-w-[44ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">No classification has been published for this race.</p>
      </div>
    );
  }
  if (raceDone) {
    return (
      <div>
        <p className="bc-label text-[color:var(--bc-silver)]">Chequered flag</p>
        <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">Results not in yet</p>
        <p className="mt-2 max-w-[44ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">The race has finished. Its classification arrives shortly.</p>
      </div>
    );
  }
  return null;
}

export function RaceHero(props: RaceHeroProps) {
  const { race, rounds, sprintWeekend, phase, sessions, zone, dates, lapLength, outline, photo, mapNote, resultsCta } = props;
  const { big, small } = titleParts(race.name);
  // Size the name to sit on one line where it can; long names drop to a floor size and wrap between words,
  // and the longest word always fits the column.
  const longest = Math.max(5, ...big.split(/\s+/).map((w) => w.length));
  const total = Math.max(6, big.length);
  const place = `${race.circuitName}${race.circuitName.includes(race.city) ? '' : `, ${race.city}`}, ${race.country}`;
  const status = phase === 'finished' ? 'Finished' : phase === 'cancelled' ? 'Cancelled' : phase === 'in-progress' ? 'Under way' : 'Upcoming';
  // Re-read the page a few seconds after every start and end still ahead, and again a minute later
  // (the first read can be the cached copy), so the hero moves from countdown to on track to result on its own.
  const watch = phase === 'cancelled' ? [] : sessions
    .filter((s) => s.phase !== 'finished' && s.phase !== 'cancelled' && s.iso.includes('T'))
    .flatMap((s) => [Date.parse(s.iso), sessionEndMs(s)])
    .flatMap((t) => [t, t + 70_000])
    .filter(Number.isFinite)
    .map((t) => new Date(t).toISOString());

  const facts: Array<{ k: string; v: ReactNode }> = [
    { k: dates.label, v: dates.value },
    { k: 'Lap length', v: lapLength },
    { k: 'Format', v: sprintWeekend ? 'Sprint weekend' : 'Conventional' },
  ];
  // The circuit's clock matters while the weekend is ahead or running; afterwards the place is the fact.
  if (zone && phase !== 'finished' && phase !== 'cancelled') facts.push({ k: `Time in ${race.city}`, v: <ZoneClock timeZone={zone} className="text-[1.15rem] leading-none" /> });
  else facts.push({ k: 'Location', v: `${race.city}, ${race.country}` });

  return (
    <section aria-labelledby="race-title" className="bc relative isolate overflow-hidden">
      {watch.length > 0 && <AutoRefresh everyMs={300_000} watch={watch} />}
      <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
      <Floodlights className="pointer-events-none absolute inset-y-0 -left-[20%] -right-[20%] z-0 lg:left-[38%] lg:-right-[10%] [&>div]:absolute [&>div]:inset-0" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />

      <div className="ds-container relative z-[1] pt-6 md:pt-10">
        <Breadcrumbs items={[{ label: 'Schedule', href: '/schedule' }, { label: String(race.season), href: `/schedule/${race.season}` }, { label: race.name }]} />

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 pb-12 md:mt-12 lg:grid-cols-12 lg:gap-8 lg:pb-16">
          <div className="min-w-0 lg:col-span-7 lg:self-center">
            <p className="bc-label bc-in-up flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]" style={d(60)}>
              <span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />
              <span className="whitespace-nowrap">Round {race.round} of {rounds}</span>
              <span className="whitespace-nowrap"><span aria-hidden className="mr-3 text-[color:var(--bc-titanium)]">/</span>{race.season}{sprintWeekend ? ' · Sprint' : ''}</span>
              <span className="whitespace-nowrap"><span aria-hidden className="mr-3 text-[color:var(--bc-titanium)]">/</span>{status}</span>
            </p>
            <h1 id="race-title" className="mt-5">
              <Line
                delay={140}
                className="bc-display text-[length:min(7rem,calc(var(--fit)/(var(--n)*0.86)),max(calc(var(--fit)/(var(--t)*0.86)),var(--floor)))] text-[color:var(--bc-white)] [--fit:calc(100vw_-_2*var(--page-margin))] [--floor:3.75rem] lg:[--fit:min(52vw,58rem)] lg:[--floor:4rem]"
                style={{ '--n': longest, '--t': total, textWrap: 'balance' } as CSSProperties}
              >
                {big}
              </Line>
              <Line delay={240} className="mt-3 text-[clamp(1.2rem,2.2vw,1.8rem)] font-medium leading-tight text-[color:var(--bc-silver)]">
                {small ? `${small} ` : ''}{race.season}
              </Line>
            </h1>
            <p className="bc-in-up mt-4 max-w-[48ch] text-[1.02rem] leading-relaxed text-[color:var(--bc-white)]" style={d(320)}>{place}</p>

            <div className="bc-in-up mt-9 border-t border-white/10 pt-7" style={d(420)}>
              <WeekendState {...props} city={race.city} />
            </div>

            <div className="bc-in-up mt-8 flex flex-wrap gap-3" style={d(520)}>
              <PressLink href="#results" variant="solid">{resultsCta} <span aria-hidden>→</span></PressLink>
              <PressLink href="#sessions" variant="ghost">Session times</PressLink>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-5 lg:self-center">
            {outline ? (
              <figure className="bc-in-up mx-auto w-full max-w-[34rem] lg:max-w-none" style={d(260)}>
                <div className="relative aspect-[4/3] w-full">
                  <CircuitStreak d={outline.d} width={outline.width} height={outline.height} label={`Layout of ${race.circuitName}`} />
                  <div aria-hidden className="bc-in-horizon absolute inset-x-[4%] bottom-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" style={d(200)} />
                </div>
                <figcaption className="bc-label mt-4 text-[color:var(--bc-silver)]">{race.circuitName}</figcaption>
              </figure>
            ) : photo ? (
              <div className="bc-in-up" style={d(260)}>
                <Media
                  src={photo.src}
                  alt={`Photograph of ${race.circuitName}`}
                  kind="wide"
                  ratio={photo.width && photo.height ? `${photo.width} / ${photo.height}` : undefined}
                  sizes="(max-width: 1024px) 100vw, 42vw"
                  priority
                  caption={place}
                />
                <p className="mt-3 max-w-[48ch] text-[0.85rem] leading-relaxed text-[color:var(--bc-titanium)]">{mapNote}</p>
              </div>
            ) : (
              <p className="bc-in-up max-w-[44ch] border-l-2 border-white/15 pl-5 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]" style={d(260)}>{mapNote}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bc-in-up relative z-[1] border-t border-white/10 bg-[#070709]/90" style={d(620)}>
        <dl className={cn('ds-container grid grid-cols-2 gap-x-6', facts.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          {facts.map(({ k, v }, i) => (
            <div key={k} className={cn('min-w-0 py-5', i % 2 === 1 && 'border-l border-white/10 pl-6', i > 1 && 'border-t border-white/10 lg:border-t-0', i === 2 && 'lg:border-l lg:pl-6')}>
              <dt className="bc-label text-[color:var(--bc-silver)]">{k}</dt>
              <dd className="mt-2 text-[1rem] text-[color:var(--bc-white)] [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
