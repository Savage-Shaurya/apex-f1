import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import { preload } from 'react-dom';
import { cutoutAt, type BrandCData, type Figure } from './data';
import { f1PhotoAt, f1PhotoPortraitAt } from './f1-photo';
import { StudioFigure } from './StudioFigure';
import { Floodlights } from './stages';
import { Depth } from './motion';
import { AutoRefresh, Countdown, ZoneClock } from './live';
import { HeadlineTicker } from './HeadlineTicker';
import { PressLink } from './Press';
import { utcLabel } from '@/components/home/weekend';

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

function TeamBar({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-4 w-[3px] shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />;
}

/** One line of the headline, revealed by rising through its own mask. */
function Line({ children, delay, className, style }: { children: ReactNode; delay: number; className?: string; style?: CSSProperties }) {
  return <span className={cn('bc-mask', className)} style={style}><span className="bc-in-rise" style={d(delay)}>{children}</span></span>;
}

/* ----------------------------------------------------------------- stage */

type Role = 'p1' | 'p2' | 'p3';
interface Placed { f: Figure; role: Role }

/**
 * The podium under floodlights: three carbon steps (2 | 1 | 3) standing on a
 * gloss floor in real perspective, each driver standing on their own step.
 * On load the horizon light runs out, the steps rise out of the floor and
 * the floodlights strike up on P3, P2, then the winner.
 * `steps=false` (title rivals, countdown state): the drivers stand on the floor.
 */
function Podium({ figures, steps, label }: { figures: Placed[]; steps: boolean; label: string }) {
  // Step geometry, in % of the stage. Front faces are contiguous like a real podium.
  const geo = {
    p1: { left: 36, width: 28, step: 15, fig: 72, z: 3, depth: '0.5', strike: 560, rise: 200 },
    p2: { left: 9, width: 27, step: 10.5, fig: 66, z: 2, depth: '1', strike: 420, rise: 120 },
    p3: { left: 64, width: 27, step: 7.5, fig: 64, z: 1, depth: '1.2', strike: 320, rise: 280 },
  } as const;
  const floor = 8; // % of the stage height under the steps (the gloss floor in front)
  const key = figures.find((x) => x.role === 'p1');
  const keySrc = key ? cutoutAt(key.f.cutout, 540) : null;
  if (keySrc) preload(keySrc, { as: 'image', fetchPriority: 'high' });
  return (
    <div className="relative h-full w-full [--fs:1.06] lg:[--fs:1]" role="img" aria-label={label}>
      {/* gloss floor, in perspective: faint carbon weave receding to the horizon */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[-30%] bottom-0 overflow-hidden [perspective:620px]" style={{ height: `${floor + 8}%` }}>
        <div className="absolute inset-x-0 bottom-[-40%] top-0 origin-top [transform:rotateX(64deg)] [background-image:repeating-linear-gradient(90deg,rgb(255_255_255/0.07)_0_1px,transparent_1px_64px),repeating-linear-gradient(0deg,rgb(255_255_255/0.055)_0_1px,transparent_1px_64px)] [mask-image:radial-gradient(ellipse_60%_90%_at_50%_0%,#000,transparent_75%)]" />
      </div>
      {/* horizon: the light catching the floor's edge, and the pool the floodlights leave on it */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[-20%]" style={{ bottom: `${floor}%` }}>
        <div className="bc-in-horizon absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" style={d(0)} />
        <div className="absolute left-1/2 top-0 h-[22vh] w-[70%] -translate-x-1/2 bg-[radial-gradient(ellipse_50%_60%_at_50%_0%,rgb(233_240_255/0.22),transparent_72%)]" />
      </div>
      {figures.map(({ f, role }) => {
        const g = geo[role];
        const stepH = steps ? g.step : 0;
        return (
          <div key={f.slug} data-depth={g.depth} className="absolute" style={{ left: `${g.left}%`, width: `${g.width}%`, bottom: `${floor}%`, top: 0, zIndex: g.z }}>
            {steps && (
              <div className="bc-step bc-in-step inset-x-0" style={{ height: `${(stepH / (100 - floor)) * 100}%`, ...d(g.rise) }}>
                <span aria-hidden className="bc-display absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[clamp(1.2rem,2.6vw,2.6rem)] leading-none text-white/85">{role.slice(1)}</span>
              </div>
            )}
            {/* the driver stands on the step's top face */}
            <div className="bc-in-strike absolute left-1/2 -translate-x-1/2" style={{ bottom: `${(stepH / (100 - floor)) * 100}%`, height: `calc(var(--fs) * ${(g.fig / (100 - floor)) * 100}%)`, aspectRatio: '400 / 1150', ...d(g.strike) }}>
              <StudioFigure
                src={cutoutAt(f.cutout, role === 'p1' ? 540 : 400)}
                name={`${f.firstName} ${f.lastName}`}
                team={f.color}
                dim={role === 'p1' ? 1 : 0.7}
                reflection={!steps}
                priority={role === 'p1'}
                className="h-full"
              />
            </div>
          </div>
        );
      })}
      {/* the gloss floor mirrors the steps, fading with distance */}
      {steps && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden [mask-image:linear-gradient(to_bottom,rgb(0_0_0/0.6),transparent_92%)]" style={{ height: `${floor}%` }}>
          {figures.map(({ f, role }) => {
            const g = geo[role];
            return (
              <div key={f.slug} className="absolute top-0 origin-top opacity-45 [transform:scaleY(-1)_translateY(-100%)]" style={{ left: `${g.left}%`, width: `${g.width}%`, height: `${(g.step / floor) * 100}%` }}>
                {/* Steps only: a mirrored number would be cut by the floor's edge. */}
                <div className="bc-step bc-in-step inset-x-0 h-full" style={d(g.rise)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------- the state bar */

/** What's next, why it matters, where it is: the three answers under the stage. */
function StateBar({ data }: { data: BrandCData }) {
  const n = data.next;
  const t = data.title;
  const share = t && t.pointsLeft > 0 ? Math.min(1, t.gap / t.pointsLeft) : null;
  return (
    <div className="bc-in-up relative z-[5] border-t border-white/10 bg-[#070709]/90" style={d(650)}>
      <div className="ds-container grid gap-x-8 sm:grid-cols-2 xl:grid-cols-[1.1fr_1.5fr_0.8fr]">
        {data.phase === 'next' && n?.session ? (
          // The countdown is the hero itself in this state: the first answer is what just happened.
          <div className="py-5">
            <p className="bc-label text-[color:var(--bc-silver)]">Last race{data.result ? ` · round ${data.result.round}` : ''}</p>
            {data.result ? (
              <>
                <p className="bc-wide mt-2 text-[1.2rem] leading-tight text-[color:var(--bc-white)]">{data.result.winner.lastName} won</p>
                <p className="mt-1.5 text-[0.88rem] text-[color:var(--bc-silver)]">
                  <Link href={data.result.href} className="text-[color:var(--bc-white)] underline decoration-white/30 underline-offset-4 hover:decoration-[color:var(--bc-red)]">{data.result.raceName}</Link>
                  {data.result.margin ? <> · <span className="bc-mono text-[color:var(--bc-white)]">{data.result.margin} s</span> clear</> : null}
                </p>
              </>
            ) : <p className="mt-2 text-[0.95rem] text-[color:var(--bc-white)]">The last classification is unavailable right now.</p>}
          </div>
        ) : (
          <div className="py-5">
            <p className="bc-label text-[color:var(--bc-silver)]">What&apos;s next{n?.session ? ` · ${n.session.name}` : ''}</p>
            {n?.session ? (
              <>
                <Countdown iso={n.session.iso} size="m" className="mt-2" />
                <p className="mt-1.5 text-[0.88rem] text-[color:var(--bc-white)]">{n.raceName} <span className="text-[color:var(--bc-silver)]">· {utcLabel(n.session.iso)}</span></p>
              </>
            ) : <p className="mt-2 text-[0.95rem] text-[color:var(--bc-white)]">{n ? 'Every session of this weekend has started.' : 'The next race is not on the calendar yet.'}</p>}
          </div>
        )}
        <div className="border-white/10 py-5 sm:border-l sm:pl-8">
          <p className="bc-label text-[color:var(--bc-silver)]">Why it matters{t?.round ? ` · after round ${t.round}` : ''}</p>
          {data.headline && t ? (
            <>
              <p className="bc-wide mt-2 text-[1.2rem] leading-tight text-[color:var(--bc-white)]">{data.headline.text}</p>
              {!t.clinched && share !== null ? (
                <>
                  {/* Title maths: the leader's margin against every point still to win. */}
                  <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-white/12" aria-hidden>
                    <div className="bc-in-fill h-full rounded-full bg-[color:var(--bc-red)]" style={{ width: `${Math.max(2, share * 100)}%`, ...d(900) }} />
                  </div>
                  <p className="mt-2 text-[0.88rem] leading-snug text-[color:var(--bc-silver)]">
                    <span className="text-[color:var(--bc-white)]">{t.leader}</span> leads {t.rival} by <span className="bc-mono text-[color:var(--bc-white)]">{nf.format(t.gap)}</span> with <span className="bc-mono text-[color:var(--bc-white)]">{nf.format(t.pointsLeft)}</span> left over {t.roundsLeft} {t.roundsLeft === 1 ? 'round' : 'rounds'}.
                  </p>
                </>
              ) : <p className="mt-2 text-[0.88rem] text-[color:var(--bc-silver)]">{data.headline.support}</p>}
            </>
          ) : <p className="mt-2 text-[0.95rem] text-[color:var(--bc-white)]">Standings unavailable right now.</p>}
        </div>
        <div className="border-white/10 py-5 sm:col-span-2 sm:border-t xl:col-span-1 xl:border-l xl:border-t-0 xl:pl-8">
          <p className="bc-label text-[color:var(--bc-silver)]">Time at the circuit</p>
          {n?.timeZone ? (
            <p className="mt-2 flex items-baseline gap-3 xl:block">
              <ZoneClock timeZone={n.timeZone} className="block text-[1.6rem] leading-none text-[color:var(--bc-white)]" />
              <span className="mt-1.5 block text-[0.88rem] text-[color:var(--bc-silver)]">{n.place}</span>
            </p>
          ) : <p className="mt-2 text-[0.95rem] text-[color:var(--bc-white)]">Unavailable</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

/**
 * The race itself behind the stage: the official trackside photograph,
 * graded down to night (scrims keep every word on top at AA), drifting
 * slowly and parallaxing on scroll. Plain <img> with a srcset so phones
 * download a phone-sized file; the box is the hero, so nothing shifts.
 */
function HeroPhoto({ photo }: { photo: NonNullable<BrandCData['heroPhoto']> }) {
  const widths = [720, 1080, 1600, 2200];
  const portrait = [360, 540, 720];
  return (
    // Below lg the photo backs only the stage (not the whole tall phone hero), in a
    // fixed-shape box so its crop always fits; from lg it fills the hero.
    <div className="pointer-events-none absolute inset-x-0 top-0 z-0 aspect-[3/4] overflow-hidden sm:aspect-[4/3] lg:inset-0 lg:aspect-auto lg:h-auto">
      <div data-depth="1.4" className="absolute inset-[-6%_0]">
        <picture>
          {/* Each crop matches its frame (the drift layer is 12% taller than the box), so cover never cuts more than a sliver:
              phones 3:4 box -> 2:3 crop; tablets 4:3 box -> 6:5 crop; from lg the photo fills the hero, whose shape follows the viewport. */}
          <source media="(max-width: 639px)" srcSet={portrait.map((w) => `${f1PhotoPortraitAt(photo.url, w)} ${w}w`).join(', ')} sizes="100vw" />
          <source media="(max-width: 1023px)" srcSet={[864, 1296].map((w) => `${f1PhotoPortraitAt(photo.url, w, '6:5')} ${w}w`).join(', ')} sizes="100vw" />
          <source media="(max-aspect-ratio: 9/10)" srcSet={[810, 1080].map((w) => `${f1PhotoPortraitAt(photo.url, w, '3:4')} ${w}w`).join(', ')} sizes="100vw" />
          <source media="(max-aspect-ratio: 6/5)" srcSet={[1080].map((w) => `${f1PhotoPortraitAt(photo.url, w, '1:1')} ${w}w`).join(', ')} sizes="100vw" />
          <source media="(max-aspect-ratio: 31/20)" srcSet={[1080, 1440].map((w) => `${f1PhotoPortraitAt(photo.url, w, '4:3')} ${w}w`).join(', ')} sizes="100vw" />
          {/* official F1 CDN renditions chosen by width and art-directed per breakpoint; the hero box reserves the space */}
          <img
            src={f1PhotoAt(photo.url, 1600)}
            srcSet={widths.map((w) => `${f1PhotoAt(photo.url, w)} ${w}w`).join(', ')}
            sizes="100vw"
            alt={photo.alt}
            decoding="async"
            fetchPriority="high"
            className="bc-kenburns absolute inset-0 h-full w-full object-cover object-[50%_60%] opacity-[0.42] [filter:saturate(0.8)_contrast(1.08)]"
          />
        </picture>
      </div>
      {/* night grade: a cool wash, the left scrim for the words, and the floor fade */}
      <div className="absolute inset-0 bg-[rgb(5_5_8/0.35)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(5_5_6/0.15)_0%,transparent_30%,rgb(5_5_6/0.6)_72%,rgb(5_5_6)_100%)] lg:bg-[linear-gradient(90deg,rgb(5_5_6/0.94)_0%,rgb(5_5_6/0.8)_30%,rgb(5_5_6/0.2)_62%,rgb(5_5_6/0.35)_100%)]" />
    </div>
  );
}

/**
 * Homepage hero. Picks its own state from the clock and the published data:
 *   result  for four days after a Grand Prix: the podium under floodlights.
 *   next    otherwise: the countdown to the next session, the title rivals lit.
 * Under the stage it always answers what's next and why it matters, and the
 * newest headlines run along the foot. It re-reads its data every five
 * minutes and the moment a session starts.
 */
export function Hero({ data }: { data: BrandCData }) {
  const watch = [data.next?.session?.iso, data.next?.raceIso].filter((x): x is string => Boolean(x));
  return (
    <section aria-labelledby="bc-hero-title" className="relative isolate flex flex-col overflow-hidden bg-[color:var(--bc-night)] lg:min-h-[max(calc(100svh-var(--shell-h,64px)),700px)]">
      <AutoRefresh everyMs={300_000} watch={watch} />
      <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
      {data.heroPhoto && <HeroPhoto photo={data.heroPhoto} />}
      {/* atmosphere: a slow haze drifting through the floodlight (one composited layer) */}
      <div aria-hidden className="bc-haze pointer-events-none absolute inset-[-10%] bg-[radial-gradient(ellipse_40%_30%_at_60%_38%,rgb(233_240_255/0.05),transparent_70%),radial-gradient(ellipse_30%_22%_at_30%_70%,rgb(225_6_0/0.035),transparent_70%)]" />
      <Floodlights className="pointer-events-none absolute inset-y-0 -left-[10%] -right-[10%] z-0 lg:left-[30%] lg:-right-[12%] [&>div]:absolute [&>div]:inset-0" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 z-0 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
      {/* one light sweep across the stage as the lights come up */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
        <div className="bc-in-sweep absolute inset-y-0 left-0 w-[40%] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.06)_45%,rgb(255_255_255/0.10)_50%,rgb(255_255_255/0.06)_55%,transparent)]" style={d(750)} />
      </div>
      <Depth className="z-[1] flex min-h-0 flex-1 flex-col">
        {data.phase === 'result' && data.result ? <ResultStage data={data} /> : <NextStage data={data} />}
      </Depth>
      {/* Photo credits live on /references (owner decision 2026-10-26: no credit captions on pages). */}
      <StateBar data={data} />
      <HeadlineTicker items={data.wire.map(({ title, source, href, publishedMs, age }) => ({ title, source, href, publishedMs, age }))} />
    </section>
  );
}

const STAGE_GRID = 'ds-container grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)] items-end gap-2 pt-4 lg:grid-cols-12 lg:gap-6 lg:pt-8';
const STAGE_BOX = 'relative order-first -mx-3 mt-4 h-[min(60svh,540px)] min-h-[360px] sm:mx-0 lg:order-none lg:col-span-7 lg:mt-0 lg:h-auto lg:min-h-[560px] lg:self-stretch';

function ResultStage({ data }: { data: BrandCData }) {
  const r = data.result!;
  const [p1, p2, p3] = r.podium;
  const figures = [p2 && { f: p2, role: 'p2' as const }, p3 && { f: p3, role: 'p3' as const }, p1 && { f: p1, role: 'p1' as const }].filter(Boolean) as Placed[];
  return (
    <div className={STAGE_GRID}>
      <div className="relative z-[4] grid grid-cols-[minmax(0,1fr)] content-start pb-6 md:grid-cols-2 md:gap-x-10 lg:col-span-5 lg:block lg:self-center lg:pb-10" data-depth="-0.8">
        <p className="bc-label bc-in-up flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)] md:col-span-2" style={d(80)}>
          <span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />
          <span>Chequered flag</span><span aria-hidden className="text-[color:var(--bc-titanium)]">/</span><span>Round {r.round} · {r.city}</span>
        </p>
        {/* The h1 is a size container: the name is fitted to its own column (110cqi), never only to the
            viewport, so the capped container at 1920 cannot push the last letters out of the mask. */}
        <h1 id="bc-hero-title" className="mt-5 [container-type:inline-size] md:col-span-2">
          <Line delay={160} className="bc-display whitespace-nowrap text-[length:min(7.2rem,calc(var(--fit)/var(--n)))] text-[color:var(--bc-white)] [--fit:min(calc(108vw_-_36px),110cqi)] lg:[--fit:min(42vw,110cqi)]" style={{ '--n': Math.max(5, r.winner.lastName.length) } as CSSProperties}>
            {r.winner.lastName}
          </Line>
          <Line delay={280} className="mt-3 text-[clamp(1.15rem,2.1vw,1.75rem)] font-medium leading-tight text-[color:var(--bc-silver)]">wins the {r.raceName}</Line>
        </h1>
        {r.margin && p2 && (
          <p className="bc-in-up mt-4 max-w-[38ch] text-[1rem] md:col-start-1 md:row-start-3 leading-relaxed text-[color:var(--bc-silver)]" style={d(380)}>
            <span className="bc-mono text-[color:var(--bc-white)]">{r.margin} s</span> clear of {p2.lastName}{r.laps ? <> after <span className="bc-mono text-[color:var(--bc-white)]">{r.laps}</span> laps</> : null}.
          </p>
        )}
        <ol className="mt-7 max-w-md divide-y md:col-start-2 md:row-span-2 md:row-start-3 md:mt-4 md:self-start lg:mt-7 divide-white/10 border-y border-white/10">
          {r.podium.map((p, i) => (
            <li key={p.slug} className="bc-in-up flex items-center gap-3 py-0.5" style={d(440 + i * 70)}>
              <span className="bc-wide w-8 text-[0.95rem] text-[color:var(--bc-silver)]">P{p.position}</span>
              <TeamBar color={p.color} />
              <Link href={`/drivers/${p.slug}`} className="group flex min-h-11 min-w-0 flex-1 items-center py-1 leading-tight text-[0.95rem] text-[color:var(--bc-white)]">
                <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 ease-[var(--bc-ease)] group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]">{p.firstName} <span className="font-semibold">{p.lastName}</span></span>
              </Link>
              <span className="bc-mono text-[0.88rem] text-[color:var(--bc-silver)]">{p.time ?? '-'}</span>
            </li>
          ))}
        </ol>
        <div className="bc-in-up mt-7 flex flex-wrap gap-3 md:col-start-1 md:row-start-4 md:self-start" style={d(620)}>
          <PressLink href={r.href} variant="solid">Full classification <span aria-hidden>→</span></PressLink>
          <PressLink href="#bc-weekend" variant="ghost">Next race weekend</PressLink>
        </div>
      </div>
      <div className={STAGE_BOX}>
        <Podium figures={figures} steps label={`Podium of the ${r.raceName}: ${r.podium.map((p) => `P${p.position} ${p.firstName} ${p.lastName}`).join(', ')}`} />
      </div>
    </div>
  );
}

function NextStage({ data }: { data: BrandCData }) {
  const n = data.next;
  const [leader, rival] = data.standings;
  const figures = [rival && { f: rival, role: 'p2' as const }, leader && { f: leader, role: 'p1' as const }].filter(Boolean) as Placed[];
  return (
    <div className={STAGE_GRID}>
      <div className="relative z-[4] grid grid-cols-[minmax(0,1fr)] content-start pb-6 md:grid-cols-2 md:gap-x-10 lg:col-span-5 lg:block lg:self-center lg:pb-10" data-depth="-0.8">
        <p className="bc-label bc-in-up flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)] md:col-span-2" style={d(80)}>
          <span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />
          {n ? <><span>Round {n.round}</span><span aria-hidden className="text-[color:var(--bc-titanium)]">/</span><span>{n.place}</span></> : <span>Calendar</span>}
        </p>
        {n?.session ? (
          <>
            <h1 id="bc-hero-title" className="mt-5 md:col-span-2">
              <Line delay={160} className="bc-display text-[clamp(2.2rem,4.6vw,4.2rem)] text-[color:var(--bc-white)]">{n.raceName.replace(/\s+Grand Prix$/i, '')}</Line>
              <Line delay={260} className="mt-3 text-[clamp(1.15rem,2vw,1.6rem)] font-medium leading-tight text-[color:var(--bc-silver)]">{n.session.name} starts in</Line>
            </h1>
            <div className="bc-in-up md:col-start-1 md:row-start-3" style={d(360)}>
              <Countdown iso={n.session.iso} size="l" className="mt-4" />
              <p className="mt-3 text-[0.92rem] text-[color:var(--bc-silver)]">{utcLabel(n.session.iso)}</p>
            </div>
          </>
        ) : (
          <h1 id="bc-hero-title" className="mt-5 md:col-span-2"><Line delay={160} className="bc-display text-[clamp(2.4rem,5vw,4.4rem)]">{n ? `${n.raceName} under way` : 'No race on the calendar yet'}</Line></h1>
        )}
        {data.title && leader && rival && (
          <p className="bc-in-up mt-6 max-w-[42ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)] md:col-start-2 md:row-start-3 md:self-end" style={d(480)}>
            {leader.firstName} <span className="text-[color:var(--bc-white)]">{leader.lastName}</span> arrives <span className="bc-mono text-[color:var(--bc-white)]">{nf.format(data.title.gap)} pts</span> ahead of {rival.lastName}.
          </p>
        )}
        {n && (
          <div className="bc-in-up mt-7 flex flex-wrap gap-3 md:col-start-1 md:row-start-4" style={d(560)}>
            <PressLink href="#bc-weekend" variant="solid">The weekend <span aria-hidden>→</span></PressLink>
            <PressLink href={n.href} variant="ghost">Race page</PressLink>
          </div>
        )}
      </div>
      <div className={STAGE_BOX}>
        <Podium figures={figures} steps={false} label={leader && rival ? `Championship leader ${leader.firstName} ${leader.lastName} and ${rival.firstName} ${rival.lastName}` : 'Championship leaders'} />
      </div>
    </div>
  );
}
