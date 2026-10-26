import type { OpenF1Stint, OpenF1Weather } from '@apex/api-client/openf1';
import { Label, SourceNote, Stat, StatGroup, TyreBadge, type TyreCompound } from '@/components/ds';
import { SectionTitle } from '@/components/info/carbon';
import { DrawOnView } from './DrawOnView';
import { formatLapTime, stintBars, utcSeconds, type ClassifiedRow } from './sheet-model';

const COMPOUND_FILL: Record<TyreCompound, string> = {
  soft: 'var(--color-tyre-soft)',
  medium: 'var(--color-tyre-medium)',
  hard: 'var(--color-tyre-hard)',
  intermediate: 'var(--color-tyre-inter)',
  wet: 'var(--color-tyre-wet)',
};
const COMPOUND_NAME: Record<TyreCompound, string> = { soft: 'Soft', medium: 'Medium', hard: 'Hard', intermediate: 'Intermediate', wet: 'Wet' };

/**
 * The race's strategy on one page: a bar per driver in finishing order,
 * one segment per stint coloured by compound, lap numbers on the axis.
 * Entirely OpenF1 `stints`; nothing interpolated.
 */
export function StrategyChart({ rows, stints, totalLaps }: { rows: ClassifiedRow[]; stints: readonly OpenF1Stint[]; totalLaps: number }) {
  const byDriver = new Map<number, OpenF1Stint[]>();
  for (const s of stints) byDriver.set(s.driver_number, [...(byDriver.get(s.driver_number) ?? []), s]);
  const lines = rows.map((r) => ({ row: r, bars: stintBars(byDriver.get(r.number) ?? [], r.laps) })).filter((l) => l.bars.length > 0);
  if (lines.length < 3 || totalLaps < 1) return null;
  const used = new Set(lines.flatMap((l) => l.bars.map((b) => b.compound)).filter((c): c is TyreCompound => c !== null));
  const tickStep = totalLaps > 40 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(totalLaps / tickStep) + 1 }, (_, i) => i * tickStep).filter((t) => t > 0);
  const pct = (lap: number) => `${((lap - 1) / totalLaps) * 100}%`;

  return (
    <section aria-labelledby="strategy-title" className="border-t border-[color:var(--bc-rule)] py-20 md:py-28">
      <div className="ds-container">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <SectionTitle id="strategy-title" eyebrow="Tyres" title="Strategy">
            Every stint of the race, in finishing order. Each colour is a tyre compound; a break in the bar is a pit stop.
          </SectionTitle>
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Compounds used">
            {[...used].map((c) => (
              <li key={c}><TyreBadge compound={c} showName /></li>
            ))}
          </ul>
        </div>

        <DrawOnView className="bcp-panel mt-10 p-4 sm:p-6 md:mt-12 md:p-8">
          <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
            <span />
            <div aria-hidden className="relative mb-2 h-5">
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 -translate-x-1/2 font-text text-caption text-fg-3" style={{ left: pct(t + 1) }}>{t}</span>
              ))}
            </div>
          </div>
          <ol className="grid gap-1.5">
            {lines.map(({ row, bars }) => (
              <li key={row.number} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
                <span className="font-text text-ui font-[650] text-fg">{row.driver.code}</span>
                <span className="relative block h-5">
                  <span aria-hidden className="absolute inset-0 bg-[var(--rule)] opacity-60" />
                  {bars.map((b, i) => (
                    <span
                      key={i}
                      data-draw
                      aria-hidden
                      className="absolute inset-y-0 flex items-center overflow-hidden pl-1.5 font-text text-[0.75rem] font-[750] leading-none tracking-[0.04em] text-ground"
                      style={{ left: pct(b.start), width: `calc(${((b.end - b.start + 1) / totalLaps) * 100}% - 2px)`, backgroundColor: b.compound ? COMPOUND_FILL[b.compound] : 'var(--ink-faint, #7a7a84)' }}
                    >
                      {b.end - b.start >= 5 ? (b.compound ? COMPOUND_NAME[b.compound][0] : '?') : ''}
                    </span>
                  ))}
                  <span className="sr-only">
                    {row.driver.firstName} {row.driver.lastName}:{' '}
                    {bars.map((b) => `${b.compound ? COMPOUND_NAME[b.compound] : 'Unknown compound'} laps ${b.start} to ${b.end}`).join(', ')}.
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-right font-text text-caption text-fg-3">Lap</p>
        </DrawOnView>
      </div>
    </section>
  );
}

/** Weather at the end of the session, from OpenF1's own track-side samples. */
export function SessionConditions({ weather, fastest }: { weather: readonly OpenF1Weather[]; fastest?: { time: number; code: string; lap: number | null } | null }) {
  const last = [...weather].filter((w) => Number.isFinite(Date.parse(w.date))).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  const rained = weather.some((w) => (w.rainfall ?? 0) > 0);
  if (!last && !fastest) return null;
  const fmt = (v: number | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? null : v.toFixed(digits));
  return (
    <section aria-labelledby="conditions-title" className="bc-carbon border-y border-[color:var(--bc-rule)] py-16 md:py-20">
      <div className="ds-container">
        <SectionTitle id="conditions-title" size="s" eyebrow="Conditions at the flag" title="Session facts" />
        <StatGroup className="mt-10">
          {fastest && (
            <div className="min-w-0">
              <dt className="font-text text-label uppercase text-fg-3">Fastest lap</dt>
              <dd className="mt-2"><span className="bc-mono text-[1.5rem] text-white">{formatLapTime(fastest.time)}</span></dd>
              <dd className="mt-1.5 font-text text-caption text-fg-3">{fastest.code}{fastest.lap != null ? `, lap ${fastest.lap}` : ''}</dd>
            </div>
          )}
          {fmt(last?.air_temperature) && <Stat size="m" label="Air" value={fmt(last?.air_temperature)} unit="°C" />}
          {fmt(last?.track_temperature) && <Stat size="m" label="Track" value={fmt(last?.track_temperature)} unit="°C" />}
          {fmt(last?.humidity, 0) && <Stat size="m" label="Humidity" value={fmt(last?.humidity, 0)} unit="%" />}
          {fmt(last?.wind_speed) && <Stat size="m" label="Wind" value={fmt(last?.wind_speed)} unit="m/s" />}
          {last && <Stat size="m" label="Rain" value={rained ? 'Yes' : 'None'} note={rained ? 'Recorded during the session' : 'No rainfall recorded'} />}
        </StatGroup>
        {last && (
          <SourceNote className="mt-6" updated={<>Conditions as of {utcSeconds(last.date)} UTC</>} />
        )}
        {!last && <Label as="p" className="mt-6">Track-side weather is not available for this session.</Label>}
      </div>
    </section>
  );
}
