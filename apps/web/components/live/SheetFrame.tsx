import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import { AutoRefresh, Countdown } from '@/components/brand-c/live';
import { Icon } from '@/components/ds';
import { Eyebrow, fitDisplay } from '@/components/info/carbon';
import { sessionHref, type LiveNow, type SheetContext } from './sheet';
import { offsetMinutes, sessionClock, shortSessionName, type ReadFailure, type WeekendState } from './sheet-model';

export type LiveScreen = 'timing' | 'track' | 'race-control';

const SCREENS: Array<{ id: LiveScreen; href: '/live/timing' | '/live/track' | '/live/race-control'; label: string; short: string }> = [
  { id: 'timing', href: '/live/timing', label: 'Classification', short: 'Results' },
  { id: 'track', href: '/live/track', label: 'Track', short: 'Track' },
  { id: 'race-control', href: '/live/race-control', label: 'Race control', short: 'Race control' },
];

const SCREEN_TITLE: Record<LiveScreen, string> = { timing: 'classification', track: 'track', 'race-control': 'race control log' };
const SCREEN_EYEBROW: Record<LiveScreen, string> = { timing: 'Final classification', track: 'Fastest lap on track', 'race-control': 'Race control log' };

/** Re-read the page every five minutes and just after the next session starts, so it moves on by itself. */
function SelfRefresh({ next, live }: { next: SheetContext['next']; live?: LiveNow | null }) {
  const watch = [next?.start, live?.start].filter((v): v is string => Boolean(v));
  return <AutoRefresh everyMs={300_000} watch={watch} />;
}

/** Route tabs between the three screens; the chosen session travels with them. */
function ScreenTabs({ current, sessionKey }: { current: LiveScreen; sessionKey?: number }) {
  return (
    <nav aria-label="Session screens" className="min-w-0">
      <ul className="flex gap-5 sm:gap-8">
        {SCREENS.map((s) => (
          <li key={s.id} className="min-w-0">
            <Link
              href={sessionHref(s.href, sessionKey)}
              aria-current={s.id === current ? 'page' : undefined}
              className="bcp-tab inline-flex min-h-11 min-w-11 items-center justify-center text-[0.9rem] font-semibold text-[color:var(--bc-silver)] transition-colors hover:text-white aria-[current=page]:text-white"
            >
              <span className="sm:hidden">{s.short}</span>
              <span className="hidden sm:inline">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const STATE_WORD: Record<WeekendState, string> = { finished: 'Final', running: 'Under way', upcoming: 'Upcoming', cancelled: 'Cancelled' };

/** The weekend's sessions as a rail of carbon tiles: finished ones are links, the rest say when they run. */
function WeekendSwitcher({ ctx, screen }: { ctx: SheetContext; screen: LiveScreen }) {
  const href = SCREENS.find((s) => s.id === screen)!.href;
  return (
    <nav aria-label={`${ctx.title} sessions`} className="mt-12 md:mt-16">
      <p className="bc-label mb-4 text-[color:var(--bc-titanium)]">Sessions this weekend{ctx.session.gmt_offset && offsetMinutes(ctx.session.gmt_offset) != null ? ', circuit time' : ', UTC'}</p>
      <ol className="grid grid-cols-1 gap-2.5 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
        {ctx.weekend.map((w) => {
          const clock = sessionClock(w.start, ctx.session.gmt_offset);
          const current = w.key === ctx.session.session_key;
          const word = current ? 'Showing' : STATE_WORD[w.state];
          const body = (
            <>
              <span className="bc-wide block text-[0.95rem] text-white">{shortSessionName(w.name)}</span>
              <span className="bc-mono mt-1.5 block text-[0.78rem] text-[color:var(--bc-titanium)]">
                {clock.localDay ?? clock.day}
                {clock.local ? `, ${clock.local}` : `, ${clock.utc} UTC`}
              </span>
              <span className={cn('bc-label mt-3 flex items-center gap-2 text-[0.66rem]', current ? 'text-white' : w.state === 'finished' ? 'text-[color:var(--bc-silver)]' : 'text-[color:var(--bc-titanium)]')}>
                <span aria-hidden className={cn('h-[2px] w-4', current ? 'bg-[color:var(--bc-red)]' : w.state === 'finished' ? 'bg-white/45' : 'bg-white/15')} />
                {word}
              </span>
            </>
          );
          return (
            <li key={w.key} className="min-w-0">
              {w.state === 'finished' && !current ? (
                <Link href={sessionHref(href, w.key)} className="bcp-panel bcp-panel--flat group block h-full min-h-11 overflow-hidden p-4 transition-[box-shadow,background-color] duration-300 hover:bg-[#121216] hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)]">
                  <span aria-hidden className="bc-glare" />
                  <span className="sr-only">{w.name}: </span>
                  {body}
                </Link>
              ) : (
                <div
                  aria-current={current ? 'true' : undefined}
                  className={cn('bcp-panel bcp-panel--flat relative h-full overflow-hidden p-4', current ? 'shadow-[inset_0_2px_0_var(--bc-red),inset_0_0_0_1px_rgb(255_255_255/0.14)]' : 'opacity-80')}
                >
                  {current && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgb(225_6_0/0.22),transparent_75%)]" />}
                  <span className="sr-only">{w.name}{w.state === 'running' ? ' (results appear after the session)' : ''}: </span>
                  <span className="relative block">{body}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NextUp({ next }: { next: SheetContext['next'] }) {
  if (!next) return null;
  // Same convention as the session tiles: circuit time first, UTC alongside.
  const clock = sessionClock(next.start, next.gmtOffset);
  return (
    <div className="bcp-panel overflow-hidden p-6 md:p-8">
      <span aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.10),transparent)]" />
      <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-6 bg-[color:var(--bc-red)]" />Next session</p>
      <p className="bc-wide mt-4 text-[clamp(1.2rem,1rem+0.8vw,1.6rem)] leading-[1.1] text-white [overflow-wrap:anywhere]">
        {next.name}
      </p>
      <p className="mt-1 text-[0.95rem] text-[color:var(--bc-silver)]">{next.location}</p>
      <p className="bc-mono mt-3 text-[0.8rem] text-[color:var(--bc-titanium)]">
        {clock.local ? <>{clock.localDay}, {clock.local} circuit time <span aria-hidden>·</span><span className="sr-only">,</span> {clock.utc} UTC{clock.localDay !== clock.day ? ` (${clock.day})` : ''}</> : <>{clock.day}, {clock.utc} UTC</>}
      </p>
      <div className="mt-6 border-t border-[color:var(--bc-rule)] pt-5">
        <p className="bc-label mb-3 text-[0.66rem] text-[color:var(--bc-titanium)]">Starts in</p>
        <Countdown iso={next.start} size="l" className="text-[clamp(1.9rem,1.2rem+2.4vw,3rem)]" />
      </div>
    </div>
  );
}

/**
 * A session is running. Apex has no live timing (out of scope), and while a
 * session runs its timing is closed to the public, so this says so plainly:
 * the running session named, when it started, and what the page shows
 * instead. `locked` means a read was refused on this render.
 */
function SessionRunning({ live, locked, size = 'm', shown, latestHref }: { live: LiveNow; locked: boolean; size?: 'm' | 'l'; shown?: string; latestHref?: string }) {
  const clock = sessionClock(live.start, live.gmtOffset);
  const started = clock.local ? `${clock.local} circuit time (${clock.utc} UTC)` : `${clock.utc} UTC`;
  return (
    <section aria-labelledby="running-title" className={cn('bcp-panel overflow-hidden shadow-[inset_3px_0_0_var(--bc-red),inset_0_0_0_1px_rgb(255_255_255/0.08)]', size === 'l' ? 'p-7 md:p-10' : 'p-6 md:p-8')}>
      <span aria-hidden className="pointer-events-none absolute -left-10 top-0 h-full w-40 bg-[radial-gradient(ellipse_60%_60%_at_0%_30%,rgb(225_6_0/0.16),transparent_75%)]" />
      <p className="bc-label relative text-white">Session under way</p>
      <p id="running-title" className={cn('bc-wide relative text-white [overflow-wrap:anywhere]', size === 'l' ? 'mt-5 text-[clamp(1.5rem,1.1rem+1.6vw,2.4rem)] leading-[1.08]' : 'mt-3 text-[1.25rem] leading-[1.1]')}>
        {live.name}, {live.location}
      </p>
      <p className="bc-mono relative mt-2 text-[0.8rem] text-[color:var(--bc-titanium)]">Started {started}</p>
      <div className={cn('relative grid text-[color:var(--bc-silver)]', size === 'l' ? 'mt-6 max-w-[60ch] gap-3 text-[1.05rem] leading-relaxed' : 'mt-4 gap-2 text-[0.95rem] leading-relaxed')}>
        <p>
          {locked ? 'Final timing returns here once this session ends.' : 'These pages show final timing once each session has finished.'}{' '}
          Its classification appears here after the chequered flag.
        </p>
        {shown && <p>{shown}</p>}
      </div>
      {latestHref && (
        <Link href={latestHref} className="relative mt-6 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)] transition-colors hover:bg-white/10">
          Latest finished session <span aria-hidden>→</span>
        </Link>
      )}
    </section>
  );
}

/** Sticky sub-bar: what this is (final, never live), which session, and the three screens. */
function SubBar({ children, tabs }: { children: ReactNode; tabs: ReactNode }) {
  return (
    <div className="sticky top-[var(--nav-offset,0px)] z-20 border-b border-[color:var(--bc-rule)] bg-[#070709]/95 transition-[top] duration-[var(--duration-slow)]">
      <div className="ds-container flex flex-wrap items-center justify-between gap-x-8 gap-y-0.5 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">{children}</div>
        {tabs}
      </div>
    </div>
  );
}

/**
 * Header for every /live screen in Carbon & Light: a sticky sub-bar, the
 * session set large under the floodlight, what the data is (final timing,
 * never live), the next session counting down and the weekend rail.
 */
export function SheetFrame({ ctx, screen, children }: { ctx: SheetContext; screen: LiveScreen; children: ReactNode }) {
  const end = sessionClock(ctx.session.date_end, ctx.session.gmt_offset);
  const where = [ctx.race ? `Round ${ctx.race.round}` : null, ctx.session.location, String(ctx.season)].filter(Boolean).join(' · ');
  const name = ctx.session.session_name;
  return (
    // Focus targets keep clear of the header and this sticky bar when tabbing backwards (WCAG 2.4.11).
    <article className="bc bcp relative overflow-x-clip [&_a]:scroll-mt-40 [&_button]:scroll-mt-40" data-screen={screen}>
      <SelfRefresh next={ctx.next} live={ctx.liveNow} />
      <SubBar tabs={<ScreenTabs current={screen} sessionKey={ctx.session.session_key} />}>
        <span className="bc-label rounded-full bg-white px-2.5 py-1 text-[0.66rem] text-[color:var(--bc-night)]">Final</span>
        <span className="min-w-0 text-[0.9rem] font-semibold text-white [overflow-wrap:anywhere]">
          {ctx.title}
          <span className="font-normal text-[color:var(--bc-silver)]"> · {name}</span>
        </span>
      </SubBar>

      <header className="relative isolate">
        <div aria-hidden className="bcp-flood pointer-events-none absolute inset-0 -z-10" />
        <div className="ds-container pb-14 pt-12 md:pb-20 md:pt-20">
          <div className="grid items-end gap-x-10 gap-y-10 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              <Eyebrow className="bc-in-up">{SCREEN_EYEBROW[screen]} · {where}</Eyebrow>
              <h1 className="mt-5 text-white">
                <span className="sr-only">{ctx.title}, </span>
                <span className="bc-mask bcp-fit" style={fitDisplay(name, { max: 8, lg: 0.56 })}>
                  <span className="bc-display bc-in-rise" style={{ '--d': '60ms' } as CSSProperties}>{name}</span>
                </span>
                <span className="sr-only"> {SCREEN_TITLE[screen]}</span>
              </h1>
              <p aria-hidden className="bc-wide bc-in-up mt-4 text-[clamp(1.1rem,0.85rem+1.2vw,1.9rem)] leading-[1.1] text-[color:var(--bc-silver)] [overflow-wrap:anywhere]" style={{ '--d': '160ms' } as CSSProperties}>{ctx.title}</p>
              <p className="bc-in-up mt-7 max-w-[52ch] text-pretty text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]" style={{ '--d': '240ms' } as CSSProperties}>
                Final timing. The session ended {end.localDay ?? end.day}
                {end.local ? `, ${end.local} circuit time` : `, ${end.utc} UTC`}. Each session appears here once it has finished.
              </p>
              {ctx.race && (
                <Link href={ctx.race.href} className="bc-in-up mt-7 inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)] transition-colors hover:bg-white/10" style={{ '--d': '300ms' } as CSSProperties}>
                  {ctx.race.name} weekend <span aria-hidden>→</span>
                </Link>
              )}
            </div>
            <div className="bc-in-up min-w-0 lg:col-span-5" style={{ '--d': '200ms' } as CSSProperties}>
              {ctx.liveNow ? (
                <SessionRunning live={ctx.liveNow} locked={ctx.locked} shown={`Below is the final timing of the ${name.toLowerCase()} in ${ctx.session.location}, the latest finished session.`} />
              ) : (
                <NextUp next={ctx.next} />
              )}
            </div>
          </div>
          {ctx.notice && (
            <div className="bcp-panel bcp-panel--flat mt-10 flex gap-4 p-5 md:p-6" role="note">
              <Icon name="info" size={20} className="mt-0.5 shrink-0 text-[color:var(--bc-silver)]" />
              <div className="min-w-0">
                <p className="font-semibold text-white">A newer session is waiting for its results</p>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">{ctx.notice}</p>
              </div>
            </div>
          )}
          <WeekendSwitcher ctx={ctx} screen={screen} />
        </div>
        <div aria-hidden className="bcp-horizon bc-in-horizon" />
      </header>
      {children}
    </article>
  );
}

const FAILURE_TITLE: Record<ReadFailure, string> = {
  locked: 'Back after the session',
  network: 'Timing unavailable right now',
  invalid: 'Timing unavailable right now',
};

/** The whole screen when timing cannot be read or nothing has finished yet. */
export function SheetUnavailable({ screen, title, reason, cause, liveNow, next, requested }: {
  screen: LiveScreen;
  title: string;
  reason: string;
  /** Omitted when nothing has finished yet (not a failure). */
  cause?: ReadFailure;
  liveNow?: LiveNow | null;
  next?: SheetContext['next'];
  /** A specific session was asked for (?session=); offer the latest readable one. */
  requested?: boolean;
}) {
  const locked = cause === 'locked';
  return (
    <article className="bc bcp relative overflow-x-clip" data-screen={screen}>
      <SelfRefresh next={next ?? null} live={liveNow} />
      <SubBar tabs={<ScreenTabs current={screen} />}>
        <span className={cn('bc-label rounded-full px-2.5 py-1 text-[0.66rem]', locked ? 'bg-[color:var(--bc-red)] text-white' : 'text-[color:var(--bc-silver)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]')}>{locked ? 'Session under way' : 'Unavailable'}</span>
      </SubBar>
      <section className="relative isolate">
        <div aria-hidden className="bcp-flood pointer-events-none absolute inset-0 -z-10" />
        <div className="ds-container py-16 md:py-24">
          <Eyebrow>{SCREEN_EYEBROW[screen]}</Eyebrow>
          <h1 className="mt-5 text-white">
            <span className="bc-display bcp-fit block" style={fitDisplay(title, { max: 7.5 })}>{title}</span>
          </h1>
          <div className="mt-12 grid gap-x-10 gap-y-8 md:mt-16 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7">
              {locked && liveNow ? (
                <SessionRunning live={liveNow} locked size="l" latestHref={requested ? SCREENS.find((s) => s.id === screen)!.href : undefined} />
              ) : (
                <div className="bcp-panel p-7 md:p-10">
                  <p className="bc-wide text-[clamp(1.3rem,1rem+1.2vw,2rem)] leading-[1.1] text-white">{cause ? FAILURE_TITLE[cause] : `${title} not in yet`}</p>
                  <p className="mt-4 max-w-[58ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">{reason} Each session appears here once it has finished.</p>
                  <Link href="/schedule" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-6 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-colors hover:bg-[color:var(--bc-silver)]">
                    Race calendar <span aria-hidden>→</span>
                  </Link>
                </div>
              )}
            </div>
            {next && (
              <div className="min-w-0 lg:col-span-5">
                <NextUp next={next} />
              </div>
            )}
          </div>
        </div>
        <div aria-hidden className="bcp-horizon" />
      </section>
    </article>
  );
}

/** Links to the two other screens, closing each page. */
export function OtherScreens({ current, sessionKey }: { current: LiveScreen; sessionKey: number }) {
  const others = SCREENS.filter((s) => s.id !== current);
  return (
    <nav aria-label="More from this session" className="ds-container pb-24 md:pb-32">
      <ul className="grid gap-3 sm:grid-cols-2">
        {others.map((s) => (
          <li key={s.id} className="min-w-0">
            <Link href={sessionHref(s.href, sessionKey)} className="bcp-panel group @container flex min-h-24 items-center justify-between gap-6 overflow-hidden p-6 transition-shadow duration-300 hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] md:p-8">
              <span aria-hidden className="bc-glare" />
              <span className="min-w-0">
                <span className="bc-label block text-[color:var(--bc-titanium)]">This session</span>
                <span className="bc-wide mt-2 block text-[clamp(0.8rem,min(1rem+0.8vw,(100cqi_-_4.5rem)_/_10.4),1.6rem)] text-white">{s.label}</span>
              </span>
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)] transition-transform duration-300 group-hover:translate-x-1">→</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/references" className="mt-6 inline-flex min-h-11 items-center gap-2 text-[0.85rem] text-[color:var(--bc-titanium)] transition-colors hover:text-white">
        <Icon name="info" size={16} />
        Sources and licences
      </Link>
    </nav>
  );
}
