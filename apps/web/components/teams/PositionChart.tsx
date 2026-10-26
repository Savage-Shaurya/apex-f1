import type { HistoryRow } from './championship-history';

/**
 * Championship position for every season as columns, oldest on the left
 * (dataviz: one series, so no legend beyond the one mark that differs). A
 * taller column is a better finish: P1 reaches the top rule, the lowest place
 * on the sheet sits just above the baseline. Championship seasons are solid
 * ink, every other season secondary ink (both at least 3:1 on carbon and
 * paper); red is never used for a result. Decades are labelled under the
 * axis; the table below carries every value as text, and each column names
 * its season in a pointer tooltip. Narrow screens scroll the sheet sideways
 * inside a focusable region.
 */
export function PositionChart({ rows, name }: { rows: readonly HistoryRow[]; name: string }) {
  const seasons = rows.slice().sort((a, b) => a.year - b.year);
  const ranked = seasons.filter((r) => r.position !== null);
  if (!ranked.length) return null;
  const worst = Math.max(...ranked.map((r) => r.position!));
  const first = seasons[0]!.year;
  const last = seasons.at(-1)!.year;
  const span = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const byYear = new Map(seasons.map((r) => [r.year, r]));
  const titles = ranked.filter((r) => r.position === 1).length;
  return (
    <figure className="min-w-0">
      <div
        role="region"
        tabIndex={0}
        aria-label={`${name}: Constructors' Championship position by season, ${first} to ${last}. ${titles} ${titles === 1 ? 'title' : 'titles'}; best finishes are the tallest columns. Every season is listed in the table below.`}
        className="min-w-0 overflow-x-auto focus-visible:outline-offset-4"
      >
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)]" style={{ minWidth: `calc(2.5rem + ${span.length * 0.875}rem)` }}>
          <div aria-hidden className="flex h-[13rem] flex-col justify-between pb-0.5 font-text text-caption tabular-nums text-fg-3 md:h-[16rem]">
            <span className="leading-none">P1</span>
            <span>P{worst}</span>
          </div>
          <div className="relative flex h-[13rem] items-end gap-[2px] border-b border-rule-strong md:h-[16rem]">
            <span aria-hidden className="absolute inset-x-0 top-0 border-t border-dashed border-rule-strong" />
            {span.map((year) => {
              const r = byYear.get(year);
              if (!r || r.position === null) {
                return <span key={year} aria-hidden title={r ? `${year}: unranked` : `${year}: not in the championship`} className="block h-full min-w-0 flex-1" />;
              }
              const height = ((worst - r.position + 1) / worst) * 100;
              return (
                <span
                  key={year}
                  aria-hidden
                  title={`${year}: P${r.position}, ${r.points} pts, ${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`}
                  className="block min-w-0 flex-1"
                  style={{ height: `max(3px, ${height.toFixed(2)}%)`, backgroundColor: r.position === 1 ? 'var(--fg)' : 'var(--fg-3)' }}
                />
              );
            })}
          </div>
          <span aria-hidden />
          <div aria-hidden className="mt-2 flex gap-[2px]">
            {span.map((year) => (
              <span key={year} className="relative block h-4 min-w-0 flex-1">
                {year % 10 === 0 && <span className="absolute left-0 top-0 whitespace-nowrap font-text text-caption tabular-nums text-fg-2">{year}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-text text-small text-fg-2">
        <span className="inline-flex items-center gap-2"><span aria-hidden className="block h-3.5 w-2 bg-fg" />Constructors&apos; champion</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="block h-3.5 w-2 bg-fg-3" />Other seasons</span>
        <span className="text-fg-3">Taller is better: P1 reaches the dashed line. Gaps are seasons the team was not classified.</span>
      </figcaption>
    </figure>
  );
}
