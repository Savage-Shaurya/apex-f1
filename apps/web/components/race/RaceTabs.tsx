'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@apex/ui';

export interface RaceTab {
  id: string;
  label: string;
  /** A short status after the label ("Final", "Not run"), in words. */
  note?: string;
  content: ReactNode;
}

/**
 * Session tabs for the results (WAI-ARIA tabs: arrow keys, Home, End). Pills
 * on carbon, the chosen one lit white. Every panel is in the server HTML;
 * inactive ones are `hidden`, so switching never fetches or shifts layout
 * above the panel. The pills wrap on narrow phones instead of scrolling.
 */
export function RaceTabs({ tabs, initial, label }: { tabs: RaceTab[]; initial?: string; label: string }) {
  const base = useId();
  const [active, setActive] = useState(initial && tabs.some((t) => t.id === initial) ? initial : tabs[0]?.id);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(tabs[n]!.id);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (e.key in map) { e.preventDefault(); select(map[e.key]!); }
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(n) => { refs.current[i] = n; }}
              id={`${base}-t-${t.id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`${base}-p-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.9rem] font-semibold transition-[background-color,color,box-shadow] duration-200',
                on ? 'bg-[color:var(--bc-white)] text-[color:var(--bc-night)]' : 'text-[color:var(--bc-silver)] ring-1 ring-white/15 hover:text-white hover:ring-white/35',
              )}
            >
              {t.label}
              {t.note && <span className={cn('bc-label text-[0.6rem]', on ? 'text-[#3f3f46]' : 'text-[color:var(--bc-titanium)]')}>{t.note}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} id={`${base}-p-${t.id}`} role="tabpanel" aria-labelledby={`${base}-t-${t.id}`} hidden={t.id !== active} tabIndex={0} className="mt-8 rounded-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white md:mt-10">
          {t.content}
        </div>
      ))}
    </div>
  );
}
