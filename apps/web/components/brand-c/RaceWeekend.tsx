import Link from 'next/link';
import { cn } from '@apex/ui';
import type { BrandCData, SessionRow } from './data';
import { CircuitStreak } from './CircuitStreak';
import { Countdown, ViewerTime, ZoneClock } from './live';
import { utcLabel } from '@/components/home/weekend';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Status({ s }: { s: SessionRow }) {
  if (s.status === 'next') return <span className="bc-label rounded-full bg-[color:var(--bc-red)] px-2.5 py-1 text-[0.66rem] text-white">Next</span>;
  if (s.status === 'classified') return <span className="bc-label text-[0.66rem] text-[color:var(--bc-silver)]">Final</span>;
  if (s.status === 'started') return <span className="bc-label text-[0.66rem] text-[color:var(--bc-silver)]">Started</span>;
  return null;
}

/** "4.304 km": the figure rolls up from zero the first time it is seen (ScrollMotion). */
function LapLength({ text }: { text: string }) {
  const m = text.match(/^([\d.]+)(.*)$/);
  if (!m) return <>{text}</>;
  const dec = m[1]!.split('.')[1]?.length ?? 0;
  return <><span data-count={m[1]} data-dec={dec}>{m[1]}</span>{m[2]}</>;
}

/** Race-weekend module: the real outline lapped by light, every session in your time and the circuit's, the forecast per session. */
export function RaceWeekend({ data }: { data: BrandCData }) {
  const n = data.next;
  if (!n) {
    return (
      <section id="bc-weekend" className="bc-carbon py-24">
        <div className="ds-container">
          <h2 className="bc-display text-[clamp(2rem,4vw,3.2rem)]">Race weekend</h2>
          <p className="mt-4 max-w-[52ch] text-[color:var(--bc-titanium)]">The next race is not on the published calendar yet. It appears here on its own as soon as it is.</p>
        </div>
      </section>
    );
  }
  const first = n.sessions[0]?.iso;
  const dates = first ? `${dayFmt.format(Date.parse(first))} – ${dayFmt.format(Date.parse(n.raceIso))}` : null;
  return (
    <section id="bc-weekend" aria-labelledby="bc-weekend-title" className="relative overflow-hidden border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-carbon)] py-20 lg:py-28">
      <div aria-hidden className="absolute -top-40 left-1/2 h-80 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.07),transparent)]" />
      <div className="ds-container relative">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div className="min-w-0">
            <p data-rv className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Race weekend · Round {n.round}{dates ? ` · ${dates}` : ''}</p>
            <h2 data-rv id="bc-weekend-title" className="bc-display mt-4 text-[clamp(2rem,4.6vw,3.8rem)]">{n.raceName}</h2>
            <p data-rv className="mt-3 text-[1rem] text-[color:var(--bc-silver)]">{n.circuitName} · {n.place}</p>
          </div>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-12">
          <div data-rv className="group relative overflow-hidden rounded-[22px] bg-[color:var(--bc-night)] ring-1 ring-[color:var(--bc-rule)] lg:col-span-7">
            <div aria-hidden className="bc-carbon absolute inset-0 opacity-60" />
            <div className="relative aspect-[16/12] p-6 sm:aspect-[16/11] sm:p-10">
              {n.outline
                ? <CircuitStreak d={n.outline.d} width={n.outline.width} height={n.outline.height} label={`Outline of ${n.circuitName}`} />
                : <p className="grid h-full place-items-center text-sm text-[color:var(--bc-titanium)]">Circuit outline unavailable for this layout.</p>}
            </div>
            <dl className="relative grid grid-cols-2 gap-px border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-rule)] sm:grid-cols-3">
              <div className="bg-[color:var(--bc-night)] p-5">
                <dt className="bc-label text-[color:var(--bc-titanium)]">Lap</dt>
                <dd className="bc-mono mt-1.5 text-[1.15rem]">{n.lapLength ? <LapLength text={n.lapLength} /> : 'Not published'}</dd>
              </div>
              <div className="bg-[color:var(--bc-night)] p-5">
                <dt className="bc-label text-[color:var(--bc-titanium)]">Local time</dt>
                <dd className="mt-1.5 text-[1.15rem]">{n.timeZone ? <ZoneClock timeZone={n.timeZone} /> : 'Unavailable'}</dd>
              </div>
              <div className="col-span-2 bg-[color:var(--bc-night)] p-5 sm:col-span-1">
                <dt className="bc-label text-[color:var(--bc-titanium)]">Forecast</dt>
                <dd className="mt-1.5 text-[0.9rem] leading-snug text-[color:var(--bc-silver)]">{n.weatherSummary ?? 'Not available yet'}</dd>
              </div>
            </dl>
          </div>

          <ol className="lg:col-span-5" aria-label="Sessions">
            {n.sessions.map((s) => (
              <li data-rv key={s.kind + s.iso} className={cn('relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-[color:var(--bc-rule)] py-4 pl-5', s.status === 'next' && 'bg-[linear-gradient(90deg,rgb(225_6_0/0.12),transparent_70%)]')}>
                <span aria-hidden className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-full', s.status === 'next' ? 'bg-[color:var(--bc-red)]' : s.status === 'upcoming' ? 'bg-white/15' : 'bg-white/40')} />
                <div className="min-w-0">
                  <p className="flex items-center gap-3">
                    <span className="bc-wide text-[1.02rem]">{s.name}</span>
                    <Status s={s} />
                  </p>
                  <p className="mt-1 text-[0.875rem] leading-normal text-[color:var(--bc-titanium)]">
                    <ViewerTime iso={s.iso} utc={utcLabel(s.iso)} className="text-[color:var(--bc-silver)]" /> your time
                    {s.airC !== null && <> · <span className="bc-mono">{Math.round(s.airC)}°C</span></>}
                    {s.rainPct !== null && <> · rain <span className="bc-mono">{Math.round(s.rainPct)}%</span></>}
                  </p>
                </div>
                <div className="text-right">
                  {s.podium ? (
                    <span className="flex gap-2">
                      {s.podium.map((p, i) => (
                        <span key={p.code} className="bc-mono flex items-center gap-1.5 text-[0.82rem]">
                          <span aria-hidden className="h-3 w-[3px] rounded-full" style={{ backgroundColor: p.color ?? '#5d6068' }} />
                          <span className="sr-only">P{i + 1} </span>{p.code}
                        </span>
                      ))}
                    </span>
                  ) : s.status === 'next' ? <Countdown iso={s.iso} size="s" rolling={false} /> : s.status === 'started' ? <span className="text-[0.8rem] text-[color:var(--bc-titanium)]">Result after the session</span> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {n.photo && (
          <figure data-rv className="relative mt-6 overflow-hidden rounded-[22px] ring-1 ring-[color:var(--bc-rule)]">
            <div className="relative aspect-[3/2] bg-[color:var(--bc-carbon-2)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- Commons thumbnail bucket chosen upstream; box reserves the space */}
              <img src={n.photo.src} alt={`${n.circuitName}, ${n.place}`} loading="lazy" decoding="async" data-zoom className="absolute inset-0 h-full w-full object-cover" />
              <div aria-hidden className="absolute inset-0 hidden bg-[linear-gradient(180deg,transparent_40%,rgb(5_5_6/0.9))] sm:block" />
            </div>
            {/* Phones: the caption sits under the photo on the card (never on bright sky); wider: on the dark foot of the photo.
                The photo's author and licence are credited on /references (no credit captions on pages, owner 2026-10-26). */}
            <figcaption className="relative flex min-h-11 flex-wrap items-center gap-x-2 bg-[color:var(--bc-carbon-2)] px-5 py-2 text-[0.8125rem] text-[color:var(--bc-silver)] sm:absolute sm:bottom-1 sm:left-5 sm:right-5 sm:bg-transparent sm:p-0">
              <span className="bc-wide text-[0.9rem] text-white">{n.circuitName}</span>
            </figcaption>
          </figure>
        )}
        <p className="mt-8"><Link href={n.href} className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-[color:var(--bc-white)] underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">Everything about this weekend <span aria-hidden>→</span></Link></p>
      </div>
    </section>
  );
}
