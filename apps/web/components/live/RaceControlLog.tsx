'use client';

import { useMemo, useState } from 'react';
import { cn } from '@apex/ui';
import { FlagBadge, Label, Tag, Timing, type FlagKind } from '@/components/ds';
import { GROUP_LABEL, type RcGroup } from './race-control-model';

export interface LogRow {
  id: string;
  utc: string;
  local: string | null;
  lap: number | null;
  group: RcGroup;
  category: string;
  /** A ds flag mark when the flag has one, otherwise its name in words. */
  flag: FlagKind | null;
  flagWords: string | null;
  message: string;
}

const ORDER: RcGroup[] = ['flags', 'safety-car', 'stewards', 'blue', 'session', 'other'];

/**
 * The message log: filters by kind (with real counts), chronological or
 * newest first, every message exactly as race control sent it. The result
 * count is announced politely when a filter changes.
 */
export function RaceControlLog({ rows }: { rows: LogRow[] }) {
  const [filter, setFilter] = useState<RcGroup | 'all'>('all');
  const [newestFirst, setNewestFirst] = useState(false);
  const counts = useMemo(() => {
    const c = new Map<RcGroup, number>();
    for (const r of rows) c.set(r.group, (c.get(r.group) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = useMemo(() => {
    const list = filter === 'all' ? rows : rows.filter((r) => r.group === filter);
    return newestFirst ? [...list].reverse() : list;
  }, [rows, filter, newestFirst]);
  const options: Array<{ id: RcGroup | 'all'; label: string; count: number }> = [
    { id: 'all', label: 'All', count: rows.length },
    ...ORDER.filter((g) => counts.get(g)).map((g) => ({ id: g, label: GROUP_LABEL[g], count: counts.get(g)! })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div role="group" aria-label="Show messages" className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={filter === o.id}
              onClick={() => setFilter(o.id)}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-text text-[0.9rem] font-semibold transition-colors duration-[var(--duration-fast)]',
                filter === o.id ? 'bg-white text-[color:var(--bc-night)]' : 'text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] hover:bg-white/10',
              )}
            >
              {o.label}
              <span className={cn('bc-mono text-[0.8rem]', filter === o.id ? 'text-[color:var(--bc-night)]' : 'text-[color:var(--bc-titanium)]')}>{o.count}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={newestFirst}
          onClick={() => setNewestFirst((v) => !v)}
          className="inline-flex min-h-11 items-center gap-2 font-text text-ui font-[650] text-fg underline decoration-[var(--rule-strong)] underline-offset-[6px] hover:decoration-[var(--accent-text)]"
        >
          {newestFirst ? 'Newest first' : 'In order of the session'}
          <span className="sr-only">(select to reverse the order)</span>
        </button>
      </div>
      <p role="status" className="mt-4 font-text text-small text-fg-3">
        {shown.length} {shown.length === 1 ? 'message' : 'messages'}{filter === 'all' ? '' : ` in ${GROUP_LABEL[filter].toLowerCase()}`}, {newestFirst ? 'newest first' : 'in session order'}.
      </p>

      <ol className="mt-6 shadow-[inset_0_1px_0_var(--rule)]">
        {shown.map((r) => (
          <li
            key={r.id}
            className={cn(
              'grid grid-cols-1 gap-x-8 gap-y-2 py-5 shadow-[inset_0_-1px_0_var(--rule)] transition-colors hover:bg-white/[0.02] md:grid-cols-[9.5rem_minmax(0,1fr)]',
              r.group === 'stewards' && 'pl-4 shadow-[inset_3px_0_0_var(--accent-text),inset_0_-1px_0_var(--rule)]',
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:flex-col md:gap-1">
              <Timing className="text-white">{r.utc} <span className="font-text text-caption text-fg-3">UTC</span></Timing>
              {r.local && <span className="font-text text-caption text-fg-3">{r.local} local</span>}
              {r.lap != null && <span className="font-text text-caption text-fg-2">Lap {r.lap}</span>}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {r.flag ? <FlagBadge flag={r.flag} /> : r.flagWords ? <Tag variant="outline">{r.flagWords}</Tag> : null}
                {r.group === 'stewards' ? <Label tone="accent">Stewards</Label> : <Label>{GROUP_LABEL[r.group]}</Label>}
              </div>
              <p className="font-text text-body tracking-[0.02em] text-fg [overflow-wrap:anywhere]">{r.message}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
